import { randomBytes } from "node:crypto";
import type { AtomicStore, Ports, SignedGovernanceTransaction, PolicyDecision } from "./ports";
import type { Payment, PaymentFailureStage, Treasury, Policy, State, Mode } from "./types";
import { AppError } from "./errors";
import { units, decimal, sameAddress } from "./validation";
import { checkLimits } from "./financial";
import { expireRequests, selectDueRequest, retryDelay, governancePending, isTerminal, MAX_TRANSIENT_FAILURES, WORKER_LEASE_MS } from "./queue";
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
      return { ...s, workerLease: { token, expiresAt: this.now() + WORKER_LEASE_MS } };
    });
    if (claimed.workerLease?.token !== token) return 0;
    let processed = 0;
    try {
      await this.store.update(s => expireRequests(s, this.now()));
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
            workerLease: { token, expiresAt: this.now() + WORKER_LEASE_MS },
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
      const candidate = selectDueRequest(s, now);
      if (!candidate) return s;
      result = {
        ...candidate,
        leaseUntil: now + WORKER_LEASE_MS,
        attempts: candidate.attempts + 1,
        lastAttemptAt: now,
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
    let stage: PaymentFailureStage = payment.status === "executing" ? "settlement" : "validation";
    try {
      if (isTerminal(payment) && governancePending(payment)) {
        stage = "governance";
        return await this.drainGovernance(payment, workerToken);
      }
      const context = await this.validate(payment);
      if (!context) return;
      if (payment.status === "queued" || payment.status === "evaluating" || payment.status === "awaiting_finality") {
        stage = "governance";
        if (payment.status === "awaiting_finality")
          return await this.inspectDecision(payment, workerToken, context.t.owner);
        return await this.evaluate(payment, context.policy, context.t, workerToken);
      }
      if (payment.status === "approved") {
        stage = "settlement";
        await this.executeApproved(payment, context.t, workerToken);
      }
    } catch (error) {
      await this.recordFailure(payment, error, workerToken, stage);
    }
  }
  private async drainGovernance(payment: Payment, token: string) {
    const reference = payment.decisionRef ?? payment.policyRegistration?.reference;
    if (!reference) throw new AppError("MISSING_DECISION", "Unresolved governance write has no durable reference.");
    const inspected = payment.decisionRef ? payment : { ...payment, rawGovernanceTransaction: payment.policyRegistration?.rawTransaction };
    const decision = await this.ports.governance.inspect(reference, inspected);
    if (!decision.finalized || decision.status === "pending") {
      await this.updateOwned(payment, token, p => ({ ...p, leaseUntil: undefined, retryAt: this.now() + 10000, consecutiveFailures: 0 }));
      return;
    }
    await this.updateOwned(payment, token, p => ({ ...p, governanceUnresolved: false,
      rawGovernanceTransaction: undefined, policyRegistration: undefined,
      leaseUntil: undefined, retryAt: undefined, consecutiveFailures: 0 }));
  }
  private assertWorker(state: State, token: string) {
    if (state.workerLease?.token !== token || state.workerLease.expiresAt <= this.now())
      throw new AppError("LEASE_LOST", "Worker lease expired before recording governance state.", 409);
  }
  private async updateOwned(payment: Payment, token: string, transform: (current: Payment, state: State) => Payment) {
    await this.store.update(state => {
      this.assertWorker(state, token);
      const current = state.payments.find(p => p.id === payment.id);
      if (!current || current.decisionRef !== payment.decisionRef ||
        current.policyRegistration?.reference !== payment.policyRegistration?.reference)
        throw new AppError("LEASE_LOST", "The inspected governance journal changed before reconciliation.", 409);
      return { ...state, payments: state.payments.map(p => p.id === payment.id ? transform(p, state) : p) };
    });
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
  private async evaluate(payment: Payment, policy: Policy, treasury: Treasury, token: string) {
    await this.ports.governance.register(policy, {
      prepared: payment.policyRegistration,
      onPrepared: prepared => this.journalGovernance(payment, treasury, token, prepared, true),
    });
    await this.store.update(state => {
      this.assertSubmissionAuthority(state, payment, treasury, token);
      return { ...state, payments: state.payments.map(p => p.id === payment.id
        ? { ...p, policyRegistration: undefined, governanceUnresolved: false } : p) };
    });
    const reference = await this.ports.governance.submit(policy, payment, {
      onPrepared: prepared => this.journalGovernance(payment, treasury, token, prepared, false),
    });
    await this.finishEvaluationSubmission(payment, treasury, token, reference);
  }
  private async journalGovernance(payment: Payment, treasury: Treasury, token: string,
    prepared: SignedGovernanceTransaction, registration: boolean) {
    await this.store.update(state => {
      this.assertSubmissionAuthority(state, payment, treasury, token);
      return { ...state, payments: state.payments.map(p => {
        if (p.id !== payment.id) return p;
        if (registration) return { ...p, status: "evaluating", policyRegistration: prepared, governanceUnresolved: true };
        return { ...p, status: "awaiting_finality", decisionRef: prepared.reference,
          rawGovernanceTransaction: prepared.rawTransaction, governanceUnresolved: true,
          evaluationReferences: this.references(p, prepared.reference) };
      }) };
    });
  }
  private references(payment: Payment, reference: string) {
    const history = payment.evaluationReferences ?? (payment.decisionRef ? [payment.decisionRef] : []);
    return history.includes(reference) ? history : [...history, reference];
  }
  private async finishEvaluationSubmission(payment: Payment, treasury: Treasury, token: string, reference: string) {
    await this.store.update(state => {
      this.assertSubmissionAuthority(state, payment, treasury, token);
      return { ...state, payments: state.payments.map(p => {
        if (p.id !== payment.id) return p;
        if (p.rawGovernanceTransaction && p.decisionRef !== reference)
          throw new AppError("DECISION_REFERENCE_MISMATCH", "Submitted transaction differs from its durable signing journal.", 409);
        return { ...p, status: "awaiting_finality", decisionRef: reference, governanceUnresolved: true,
          evaluationReferences: this.references(p, reference), leaseUntil: undefined,
          retryAt: undefined, consecutiveFailures: 0, error: undefined };
      }) };
    });
  }
  private assertSubmissionAuthority(state: State, payment: Payment, treasury: Treasury, token: string) {
    if (state.workerLease?.token !== token || state.workerLease.expiresAt <= this.now())
      throw new AppError("LEASE_LOST", "Worker lease expired before governance submission.", 409);
    const current = state.treasuries.find(t => t.id === payment.treasuryId);
    const request = state.payments.find(p => p.id === payment.id);
    if (!current || !sameAddress(current.owner, treasury.owner) || current.paused || !current.active ||
      current.policyVersion !== payment.policyVersion || request?.requestHash !== payment.requestHash ||
      !["queued", "evaluating", "awaiting_finality"].includes(request.status) || Date.parse(request.expiresAt) <= this.now())
      throw new AppError("AUTHORITY_CHANGED", "Spending authority changed before governance submission.", 409);
  }
  private async inspectDecision(payment: Payment, workerToken: string, expectedOwner: string) {
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
      await this.updateOwned(payment, workerToken, p => ({ ...p, leaseUntil: undefined, retryAt: this.now() + 10000, consecutiveFailures: 0 }));
      return;
    }
    const recoverable = await this.recordFinalizedDecision(payment, decision, workerToken, expectedOwner);
    if (decision.status === "unavailable" && recoverable) {
      await this.recoverDecision(payment, workerToken);
    }
  }
  private async recordFinalizedDecision(payment: Payment, decision: PolicyDecision, token: string, expectedOwner: string) {
    const verdict = decision.status;
    if (verdict === "pending") return false;
    if (
      verdict !== "unavailable" && (
      decision.requestHash !== payment.requestHash ||
      decision.mandateHash !== payment.mandateHash)
    )
      throw new AppError(
        "DECISION_MISMATCH",
        "Finalized decision does not match this request and mandate.",
      );
    let recoverable = false;
    await this.updateOwned(payment, token, (current, state) => {
      const treasury = state.treasuries.find(t => t.id === payment.treasuryId);
      const policy = state.policies.find(p => p.treasuryId === payment.treasuryId && p.version === payment.policyVersion);
      const expired = Date.parse(current.expiresAt) <= this.now();
      const authorized = current.status === "awaiting_finality" && !!treasury && !!policy &&
        sameAddress(treasury.owner, expectedOwner) &&
        treasury.active && !treasury.paused && treasury.policyVersion === payment.policyVersion &&
        current.mandateHash === policy.mandateHash && current.requestHash === payment.requestHash && !expired;
      const finalized = { ...current, governanceUnresolved: false, rawGovernanceTransaction: undefined,
        leaseUntil: undefined, retryAt: undefined, consecutiveFailures: 0 };
      if (!authorized) return isTerminal(current) ? finalized : { ...finalized,
        status: expired ? "expired" : "failed",
        ...(expired ? {} : { scan: { ...finalized.scan, failureStage: "governance" as const } }),
        error: "Spending authority changed before the finalized decision was recorded." };
      recoverable = verdict === "unavailable";
      if (verdict === "unavailable") return finalized;
      return { ...finalized, status: verdict, scan: { ...finalized.scan, verdict },
        decisionReason: decision.reason, approvalExpiresAt: Math.floor(Date.parse(current.expiresAt) / 1000), error: undefined };
    });
    return recoverable;
  }
  private async recoverDecision(payment: Payment, workerToken: string) {
    if ((await this.store.read()).payments.some(p => p.id !== payment.id && governancePending(p))) {
      await this.patch(payment.id, { leaseUntil: undefined, retryAt: this.now() + 10000 });
      return;
    }
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
      { onPrepared: prepared => this.journalGovernance(payment, context.t, workerToken, prepared, false) },
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
                evaluationReferences: history.includes(reference) ? history : [...history, reference],
                governanceUnresolved: true,
                leaseUntil: undefined,
                retryAt: undefined,
                consecutiveFailures: 0,
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
                leaseUntil: this.now() + WORKER_LEASE_MS,
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
  private async recordFailure(payment: Payment, error: unknown, token: string, stage: PaymentFailureStage) {
    const state = await this.store.read();
    if (state.workerLease?.token !== token || state.workerLease.expiresAt <= this.now()) return;
    const current = state.payments.find((p) => p.id === payment.id);
    const message =
      error instanceof AppError
        ? error.message
        : "Execution temporarily unavailable; reconciliation will retry.";
    if (!current || (error instanceof AppError && error.code === "LEASE_LOST")) return;
    const finalizedError = error instanceof AppError &&
      ["EVALUATION_FAILED", "EVALUATION_MALFORMED", "EVALUATION_RECORD_UNAVAILABLE", "POLICY_REGISTRATION_FAILED", "DECISION_MISMATCH"].includes(error.code);
    if (isTerminal(current) && !governancePending(current)) return;
    const failures = (current.consecutiveFailures ?? 0) + 1;
    if (current.status === "executing") {
      await this.updateOwned(payment, token, p => ({ ...p,
        error: message,
        consecutiveFailures: failures,
        leaseUntil: undefined,
        retryAt: this.now() + retryDelay(current, failures),
      }));
      return;
    }
    const terminal = error instanceof AppError && (error.status < 500 || finalizedError);
    const exhausted = failures >= MAX_TRANSIENT_FAILURES;
    const unresolved = !finalizedError && governancePending(current);
    const failed = !isTerminal(current) && (terminal || exhausted);
    await this.updateOwned(current, token, p => ({ ...p,
      status: failed ? "failed" : current.status,
      ...(failed ? { scan: { ...p.scan, failureStage: stage } } : {}),
      error: exhausted && !terminal ? "RPC retry budget exhausted. No funds were settled; inspect configuration before retrying this request." : message,
      consecutiveFailures: failures,
      leaseUntil: undefined,
      retryAt: (terminal || exhausted) && !unresolved ? undefined : this.now() + retryDelay(current, failures),
      governanceUnresolved: unresolved,
      rawGovernanceTransaction: finalizedError ? undefined : current.rawGovernanceTransaction,
      policyRegistration: finalizedError ? undefined : current.policyRegistration,
    }));
  }
  private async reconcile(payment: Payment, treasury: Treasury) {
    const outcome = await this.ports.settlement.reconcile(payment);
    if (outcome.status === "verification_failed") {
      await this.patch(payment.id, {
        status: "failed",
        scan: { ...payment.scan, failureStage: "settlement" },
        transactionHash: outcome.transactionHash ?? payment.transactionHash,
        error: "Successful transaction did not prove the requested payment; review its receipt before resubmitting.",
        leaseUntil: undefined,
        retryAt: undefined,
        consecutiveFailures: 0,
        rawTransaction: undefined,
      });
      return;
    }
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
                  retryAt: undefined,
                  consecutiveFailures: 0,
                  transactionHash: outcome.transactionHash ?? p.transactionHash,
                  ...(this.mode === "live" && outcome.transactionHash ? {
                    scan: { ...p.scan, verifiedSettlementHash: outcome.transactionHash },
                  } : {}),
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
        scan: { ...payment.scan, failureStage: "settlement" },
        error: "Aevum transaction reverted. No payment was settled.",
        leaseUntil: undefined,
        retryAt: undefined,
        consecutiveFailures: 0,
        rawTransaction: undefined,
      });
      return;
    }
    if (outcome.status === "not_found" && payment.rawTransaction)
      await this.ports.settlement.broadcast(payment.rawTransaction);
    await this.patch(payment.id, { leaseUntil: undefined, retryAt: this.now() + 10000,
      consecutiveFailures: 0, error: undefined });
  }
}
