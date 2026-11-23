import { randomBytes } from "node:crypto";
import type { AtomicStore, Ports } from "./ports";
import type { Payment, Treasury, Policy, State, Mode } from "./types";
import { AppError } from "./errors";
import { units, decimal, sameAddress } from "./validation";
import { checkLimits } from "./financial";
export class PaymentProcessor {
  constructor(
    readonly store: AtomicStore,
    readonly ports: Ports,
    readonly mode: Mode,
  ) {}
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  async processBatch(limit = 5) {
    const token = randomBytes(24).toString("hex");
    const claimed = await this.store.update((s) => {
      if (s.workerLease && s.workerLease.expiresAt > this.now()) return s;
      return { ...s, workerLease: { token, expiresAt: this.now() + 900000 } };
    });
    if (claimed.workerLease?.token !== token) return 0;
    let processed = 0;
    try {
      for (let index = 0; index < Math.min(20, Math.max(1, limit)); index++) {
        await this.store.update((s) => {
          if (
            s.workerLease?.token !== token ||
            s.workerLease.expiresAt <= this.now()
          )
            throw new AppError(
              "LEASE_LOST",
              "Worker lease expired; execution stopped.",
              409,
            );
          return {
            ...s,
            workerLease: { token, expiresAt: this.now() + 900000 },
          };
        });
        const request = await this.claim();
        if (!request) break;
        await this.process(request, token);
        processed++;
      }
      return processed;
    } finally {
      await this.store.update((s) =>
        s.workerLease?.token === token ? { ...s, workerLease: undefined } : s,
      );
    }
  }
  private async claim() {
    let result: Payment | undefined;
    const now = this.now();
    await this.store.update((s) => {
      const candidate =
        s.payments.find((p) => p.status === "executing") ??
        s.payments.find((p) => p.status === "approved") ??
        s.payments.find((p) => p.status === "awaiting_finality") ??
        s.payments.find((p) => p.status === "evaluating") ??
        s.payments.find((p) => p.status === "queued");
      if (!candidate || (candidate.leaseUntil ?? 0) > now) return s;
      result = {
        ...candidate,
        leaseUntil: now + 300000,
        attempts: candidate.attempts + 1,
      };
      return {
        ...s,
        payments: s.payments.map((p) => (p.id === candidate.id ? result! : p)),
      };
    });
    return result;
  }
  private async patch(id: string, patch: Partial<Payment>) {
    await this.store.update((s) => ({
      ...s,
      payments: s.payments.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }
  private async process(payment: Payment, workerToken: string) {
    try {
      const context = await this.validate(payment);
      if (!context) return;
      if (payment.status === "queued" || payment.status === "evaluating")
        return await this.evaluate(payment, context.policy);
      if (payment.status === "awaiting_finality")
        return await this.inspectDecision(payment, workerToken);
      if (payment.status === "approved")
        await this.executeApproved(payment, context.t, workerToken);
    } catch (error) {
      await this.recordFailure(payment, error);
    }
  }
  private async validate(
    payment: Payment,
  ): Promise<{ t: Treasury; policy: Policy } | null> {
    const s = await this.store.read();
    const t = s.treasuries.find((t) => t.id === payment.treasuryId);
    const policy = s.policies.find(
      (p) =>
        p.treasuryId === payment.treasuryId &&
        p.version === payment.policyVersion,
    );
    if (!t || !policy)
      throw new AppError("POLICY_NOT_FOUND", "Payment mandate is missing.");
    if (payment.status === "executing") {
      await this.reconcile(payment, t);
      return null;
    }
    if (Date.parse(payment.expiresAt) <= this.now()) {
      await this.patch(payment.id, {
        status: "expired",
        leaseUntil: undefined,
        error: "Payment authorization expired.",
      });
      return null;
    }
    if (
      payment.policyVersion !== t.policyVersion ||
      payment.mandateHash !== policy.mandateHash
    )
      throw new AppError("POLICY_CHANGED", "Mandate changed before execution.");
    const current =
      this.mode === "live"
        ? {
            ...t,
            ...(await this.ports.settlement.snapshot(t, policy.recipients)),
            week: Math.floor(this.now() / 604800000),
          }
        : t;
    if (!sameAddress(current.owner, t.owner))
      throw new AppError(
        "UNAUTHORIZED",
        "Vault ownership changed before execution.",
        403,
      );
    if (current.policyVersion !== payment.policyVersion)
      throw new AppError("POLICY_CHANGED", "The on-chain mandate changed.");
    checkLimits(
      s,
      current,
      policy,
      payment.amount,
      payment.recipient,
      this.now(),
      payment.id,
    );
    return { t, policy };
  }
  private async evaluate(payment: Payment, policy: Policy) {
    await this.ports.governance.register(policy);
    const reference = await this.ports.governance.submit(policy, payment);
    await this.patch(payment.id, {
      status: "awaiting_finality",
      decisionRef: reference,
      evaluationReferences: [
        ...(payment.evaluationReferences ?? []),
        reference,
      ],
      leaseUntil: undefined,
      error: undefined,
    });
  }
  private async inspectDecision(payment: Payment, workerToken: string) {
    if (!payment.decisionRef)
      throw new AppError(
        "MISSING_DECISION",
        "The policy decision reference is missing.",
      );
    const decision = await this.ports.governance.inspect(
      payment.decisionRef,
      payment,
    );
    if (!decision.finalized || decision.status === "pending") {
      await this.patch(payment.id, { leaseUntil: this.now() + 10000 });
      return;
    }
    if (decision.status === "unavailable") {
      await this.recoverDecision(payment, workerToken);
      return;
    }
    if (
      decision.requestHash !== payment.requestHash ||
      decision.mandateHash !== payment.mandateHash
    )
      throw new AppError(
        "DECISION_MISMATCH",
        "Finalized decision does not match this request and mandate.",
      );
    await this.patch(payment.id, {
      status: decision.status,
      decisionReason: decision.reason,
      approvalExpiresAt: Math.floor(Date.parse(payment.expiresAt) / 1000),
      leaseUntil: undefined,
    });
    return;
  }
  private async recoverDecision(payment: Payment, workerToken: string) {
    const context = await this.validate(payment);
    if (!context) return;
    const reserved = await this.store.update((state) => {
      this.assertRecoveryAuthority(state, payment, context.t, workerToken);
      const current = state.payments.find((p) => p.id === payment.id)!;
      const attempts = current.evaluationRecoveryAttempts ?? 0;
      if (attempts >= 2)
        throw new AppError(
          "EVALUATION_RECORD_UNAVAILABLE",
          "Finalized decision record remains unavailable after two retries. No payment was authorized; contact the operator or submit a new request.",
          503,
        );
      return {
        ...state,
        payments: state.payments.map((p) =>
          p.id === payment.id
            ? { ...p, evaluationRecoveryAttempts: attempts + 1 }
            : p,
        ),
      };
    });
    const current = reserved.payments.find((p) => p.id === payment.id)!;
    const reference = await this.ports.governance.submit(
      context.policy,
      current,
    );
    await this.store.update((state) => {
      this.assertRecoveryAuthority(state, payment, context.t, workerToken);
      const request = state.payments.find((p) => p.id === payment.id)!;
      const history =
        request.evaluationReferences ??
        (request.decisionRef ? [request.decisionRef] : []);
      return {
        ...state,
        payments: state.payments.map((p) =>
          p.id === payment.id
            ? {
                ...p,
                status: "awaiting_finality",
                decisionRef: reference,
                evaluationReferences: [...history, reference],
                leaseUntil: undefined,
                error: undefined,
              }
            : p,
        ),
      };
    });
  }
  private assertRecoveryAuthority(
    state: State,
    payment: Payment,
    treasury: Treasury,
    workerToken: string,
  ) {
    if (
      state.workerLease?.token !== workerToken ||
      state.workerLease.expiresAt <= this.now()
    )
      throw new AppError(
        "LEASE_LOST",
        "Worker lease expired before evaluation recovery.",
        409,
      );
    const current = state.treasuries.find((t) => t.id === payment.treasuryId);
    const request = state.payments.find((p) => p.id === payment.id);
    if (
      !current ||
      !sameAddress(current.owner, treasury.owner) ||
      current.paused ||
      !current.active ||
      current.policyVersion !== payment.policyVersion ||
      request?.status !== "awaiting_finality" ||
      Date.parse(payment.expiresAt) <= this.now()
    )
      throw new AppError(
        "AUTHORITY_CHANGED",
        "Spending authority changed before evaluation recovery.",
        409,
      );
  }
  private async executeApproved(
    payment: Payment,
    t: Treasury,
    workerToken: string,
  ) {
    const prepared = await this.ports.settlement.prepare(t, payment);
    await this.store.update((state) => {
      if (
        state.workerLease?.token !== workerToken ||
        state.workerLease.expiresAt <= this.now()
      )
        throw new AppError(
          "LEASE_LOST",
          "Worker lease expired before broadcast.",
          409,
        );
      const treasury = state.treasuries.find(
        (t) => t.id === payment.treasuryId,
      );
      const request = state.payments.find((r) => r.id === payment.id);
      if (
        !treasury ||
        !sameAddress(treasury.owner, t.owner) ||
        treasury.paused ||
        !treasury.active ||
        treasury.policyVersion !== payment.policyVersion ||
        request?.status !== "approved" ||
        Date.parse(payment.expiresAt) <= this.now()
      )
        throw new AppError(
          "AUTHORITY_CHANGED",
          "Spending authority changed before broadcast.",
          409,
        );
      return {
        ...state,
        payments: state.payments.map((r) =>
          r.id === payment.id
            ? {
                ...r,
                status: "executing",
                transactionHash:
                  this.mode === "live" ? prepared.hash : undefined,
                rawTransaction: prepared.rawTransaction,
                leaseUntil: this.now() + 300000,
              }
            : r,
        ),
      };
    });
    await this.ports.settlement.broadcast(prepared.rawTransaction);
    await this.reconcile(
      {
        ...payment,
        status: "executing",
        transactionHash: this.mode === "live" ? prepared.hash : undefined,
        rawTransaction: prepared.rawTransaction,
      },
      t,
    );
  }
  private async recordFailure(payment: Payment, error: unknown) {
    const state = await this.store.read();
    const current = state.payments.find((p) => p.id === payment.id);
    const message =
      error instanceof AppError
        ? error.message
        : "Execution temporarily unavailable; reconciliation will retry.";
    if (current?.status === "executing") {
      await this.patch(payment.id, {
        error: message,
        leaseUntil: this.now() + 10000,
      });
      return;
    }
    const terminal = error instanceof AppError;
    await this.patch(payment.id, {
      status: terminal ? "failed" : payment.status,
      error: message,
      leaseUntil: terminal ? undefined : this.now() + 15000,
    });
  }
  private async reconcile(payment: Payment, treasury: Treasury) {
    const outcome = await this.ports.settlement.reconcile(payment);
    if (outcome.status === "settled") {
      await this.store.update((s) => {
        const current = s.payments.find((p) => p.id === payment.id);
        if (!current || current.status === "settled") return s;
        const t = s.treasuries.find((t) => t.id === treasury.id)!;
        const amount = BigInt(payment.amountUnits);
        if (this.mode === "demo" && units(t.balance) < amount)
          throw new AppError(
            "INSUFFICIENT_BALANCE",
            "Treasury funds were withdrawn before settlement.",
          );
        const week = Math.floor(this.now() / 604800000);
        const updated =
          this.mode === "demo"
            ? {
                ...t,
                balance: decimal(units(t.balance) - amount),
                weeklySpent: decimal(
                  (t.week === week ? units(t.weeklySpent) : 0n) + amount,
                ),
                totalSpent: decimal(units(t.totalSpent) + amount),
                week,
              }
            : t;
        return {
          ...s,
          treasuries: s.treasuries.map((x) => (x.id === t.id ? updated : x)),
          payments: s.payments.map((p) =>
            p.id === payment.id
              ? {
                  ...p,
                  status: "settled",
                  rawTransaction: undefined,
                  error: undefined,
                  leaseUntil: undefined,
                  transactionHash: outcome.transactionHash ?? p.transactionHash,
                }
              : p,
          ),
        };
      });
      return;
    }
    if (outcome.status === "failed") {
      await this.patch(payment.id, {
        status: "failed",
        error: "Aevum transaction reverted. No payment was settled.",
        leaseUntil: undefined,
        rawTransaction: undefined,
      });
      return;
    }
    if (outcome.status === "not_found" && payment.rawTransaction)
      await this.ports.settlement.broadcast(payment.rawTransaction);
    await this.patch(payment.id, { leaseUntil: this.now() + 10000 });
  }
}
