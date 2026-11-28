import { isAddress } from "viem";
import { TUSD8_ADDRESS } from "./types";
import { PaymentProcessor } from "./processor";
import { checkLimits, spendingAvailability } from "./financial";
import { randomBytes, createHash } from "node:crypto";
import type { AtomicStore, Ports, VaultSnapshot } from "./ports";
import type {
  State,
  Treasury,
  Policy,
  Payment,
  Mode,
  Dashboard,
} from "./types";
import { AppError } from "./errors";
import {
  parsePayment,
  parsePolicy,
  policyFields,
  units,
  decimal,
  hashText,
  sameAddress,
} from "./validation";

const pending = new Set([
  "queued",
  "evaluating",
  "awaiting_finality",
  "approved",
  "executing",
]);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const ownerTreasury = (s: State, owner: string, treasuryId?: string) => {
  const owned = s.treasuries.filter((t) => sameAddress(t.owner, owner));
  if (treasuryId) {
    const selected = owned.find((t) => sameAddress(t.id, treasuryId));
    if (!selected) throw new AppError("TREASURY_NOT_FOUND", "This treasury was not found for your wallet.", 404);
    return selected;
  }
  if (owned.length > 1) throw new AppError("TREASURY_SELECTION_REQUIRED", "Choose an agent treasury before continuing.", 409);
  return owned[0];
};
const policyFor = (s: State, t: Treasury) =>
  s.policies.find(
    (p) => sameAddress(p.treasuryId, t.id) && p.version === t.policyVersion,
  );
const safePayment = ({ rawTransaction: _raw, rawGovernanceTransaction: _governanceRaw,
  policyRegistration: _registration, scan: _scan, ...payment }: Payment) =>
  payment as Payment;
const paymentsFor = (state: State, treasuryId: string) => state.payments
  .filter(payment => sameAddress(payment.treasuryId, treasuryId))
  .map(safePayment)
  .reverse();

export class AgentPayService {
  constructor(
    readonly store: AtomicStore,
    readonly ports: Ports,
    readonly mode: Mode,
  ) {}
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private treasury(s: State, owner: string, treasuryId?: string) {
    const t = ownerTreasury(s, owner, treasuryId);
    if (!t)
      throw new AppError(
        "TREASURY_NOT_FOUND",
        "Create or register a treasury first.",
        404,
      );
    return t;
  }
  private activePolicy(s: State, t: Treasury) {
    const p = policyFor(s, t);
    if (!p)
      throw new AppError(
        "POLICY_NOT_FOUND",
        "The active mandate is unavailable.",
        409,
      );
    return p;
  }
  async dashboard(owner: string, treasuryId?: string): Promise<Dashboard> {
    let s = await this.store.read();
    const stored = ownerTreasury(s, owner, treasuryId);
    if (this.mode === "live" && stored) {
      const prior = this.activePolicy(s, stored);
      const snapshot = await this.ports.settlement.snapshot(
        stored,
        prior.recipients,
      );
      this.assertSnapshotOwner(snapshot, owner);
      s = await this.store.update((current) => ({
        ...current,
        treasuries: current.treasuries.map((t) =>
          t.id === stored.id && t.policyVersion === stored.policyVersion &&
          t.keyVersion === stored.keyVersion && t.paused === stored.paused && t.active === stored.active
            ? {
                ...t,
                ...snapshot,
                policyVersion: t.policyVersion,
                active:
                  snapshot.active && snapshot.policyVersion === t.policyVersion,
                week: snapshot.week ?? Math.floor(this.now() / 604800000),
              }
            : t,
        ),
      }));
    }
    const currentTreasury = ownerTreasury(s, owner, treasuryId) ?? null;
    const currentPolicy = currentTreasury ? policyFor(s, currentTreasury) : null;
    const treasury = currentTreasury && currentPolicy ? {
      ...currentTreasury, ...spendingAvailability(s, currentTreasury, currentPolicy, this.now()),
    } : currentTreasury;
    return {
      mode: this.mode,
      owner,
      treasury,
      policy: treasury ? (policyFor(s, treasury) ?? null) : null,
      payments: treasury ? paymentsFor(s, treasury.id) : [],
      services: this.ports.services ?? [],
    };
  }
  async listAgents(owner: string) {
    const owned = (await this.store.read()).treasuries.filter((t) => sameAddress(t.owner, owner));
    const outcomes = await Promise.allSettled(owned.map((t) => this.dashboard(owner, t.id)));
    const agents = outcomes.flatMap((outcome) => {
      if (outcome.status !== "fulfilled") return [];
      const { treasury, policy } = outcome.value;
      return treasury ? [{
        ...treasury,
        ...(policy ? { perPaymentLimit: policy.perPaymentLimit, weeklyBudget: policy.weeklyBudget,
          totalBudget: policy.totalBudget, validUntil: policy.validUntil, mandateHash: policy.mandateHash,
          recipients: policy.recipients } : {}),
      }] : [];
    });
    const unavailable = outcomes.flatMap((outcome, index) => {
      if (outcome.status !== "rejected") return [];
      const treasury = owned[index];
      const ownershipMismatch = outcome.reason instanceof AppError && outcome.reason.code === "VAULT_MISMATCH";
      return [{ id: treasury.id, agentId: treasury.agentId, agentName: treasury.agentName,
        code: ownershipMismatch ? "VAULT_MISMATCH" : "VAULT_UNAVAILABLE",
        message: ownershipMismatch ? "This vault no longer matches your wallet or the configured payment token. Its controls are unavailable."
          : "This vault could not be refreshed. Try again shortly." }];
    });
    return { mode: this.mode, owner, agents, unavailable };
  }
  async getPayment(owner: string, id: string, treasuryId?: string) {
    const s = await this.store.read();
    const t = this.treasury(s, owner, treasuryId);
    const p = s.payments.find(
      (p) => p.id === id && sameAddress(p.treasuryId, t.id),
    );
    if (!p)
      throw new AppError(
        "PAYMENT_NOT_FOUND",
        "Payment request was not found.",
        404,
      );
    return safePayment(p);
  }
  async listPayments(owner: string, treasuryId: string) {
    const state = await this.store.read();
    return paymentsFor(state, this.treasury(state, owner, treasuryId).id);
  }
  async setup(owner: string, input: unknown) {
    if (!input || typeof input !== "object")
      throw new AppError(
        "INVALID_REQUEST",
        "Treasury setup fields are required.",
      );
    const { treasuryId, agentName, ...raw } = input as Record<string, unknown>;
    const policy = parsePolicy(policyFields(raw));
    if (
      typeof treasuryId !== "string" ||
      (!isAddress(treasuryId, { strict: true }) || /^0x0{40}$/i.test(treasuryId))
    )
      throw new AppError(
        "INVALID_TREASURY",
        "Enter a deployed Aevum vault address.",
      );
    if (
      typeof agentName !== "string" ||
      agentName.trim().length < 1 ||
      agentName.length > 80
    )
      throw new AppError(
        "INVALID_AGENT",
        "Enter an agent name of up to 80 characters.",
      );
    if (policy.validUntil * 1000 <= this.now())
      throw new AppError("POLICY_EXPIRED", "Choose a future mandate expiry.");
    const agentId = hashText(
      "agentpay:" + treasuryId.toLowerCase() + ":" + agentName.trim(),
    );
    let treasury: Treasury = {
      id: treasuryId,
      owner,
      executor: "0x0000000000000000000000000000000000000000",
      token: TUSD8_ADDRESS,
      agentId,
      agentName: agentName.trim(),
      balance: "0",
      paused: false,
      active: true,
      policyVersion: 1,
      keyVersion: 1,
      weeklySpent: "0",
      totalSpent: "0",
      week: Math.floor(this.now() / 604800000),
    };
    if (this.mode === "live") {
      const snapshot = await this.ports.settlement.snapshot(
        treasury,
        policy.recipients,
      );
      if (
        !sameAddress(snapshot.owner, owner) ||
        !sameAddress(snapshot.token, TUSD8_ADDRESS)
      )
        throw new AppError(
          "VAULT_MISMATCH",
          "The vault owner or token does not match.",
          403,
        );
      if (
        snapshot.policyVersion < 1 ||
        snapshot.mandateHash !== hashText(policy.mandate)
      )
        throw new AppError(
          "POLICY_NOT_CONFIGURED",
          "Configure this agent and mandate on Aevum before registration.",
          409,
        );
      this.assertSnapshotPolicy(snapshot, policy);
      treasury = {
        ...treasury,
        ...snapshot,
        week: snapshot.week ?? Math.floor(this.now() / 604800000),
        id: treasuryId,
        owner,
        agentId,
        agentName: agentName.trim(),
        policyVersion: snapshot.policyVersion,
      };
    }
    await this.store.update((s) => {
      if (s.treasuries.some((t) => sameAddress(t.id, treasuryId)))
        throw new AppError(
          "TREASURY_EXISTS",
          "This vault already has a registered agent treasury.",
          409,
        );
      return {
        ...s,
        treasuries: [...s.treasuries, treasury],
        policies: [
          ...s.policies,
          {
            ...policy,
            treasuryId,
            agentId,
            version: treasury.policyVersion,
            mandateHash: hashText(policy.mandate),
          },
        ],
      };
    });
    return this.dashboard(owner, treasuryId);
  }
  private assertSnapshotOwner(snapshot: VaultSnapshot, owner: string) {
    if (
      !sameAddress(snapshot.owner, owner) ||
      !sameAddress(snapshot.token, TUSD8_ADDRESS)
    )
      throw new AppError(
        "VAULT_MISMATCH",
        "The vault owner or token does not match.",
        403,
      );
  }
  private assertSnapshotPolicy(
    snapshot: VaultSnapshot,
    policy: Pick<
      Policy,
      | "mandate"
      | "perPaymentLimit"
      | "weeklyBudget"
      | "totalBudget"
      | "validUntil"
      | "recipients"
    >,
  ) {
    if (
      snapshot.mandateHash !== hashText(policy.mandate) ||
      units(snapshot.perPaymentLimit) !== units(policy.perPaymentLimit) ||
      units(snapshot.weeklyBudget) !== units(policy.weeklyBudget) ||
      units(snapshot.totalBudget) !== units(policy.totalBudget) ||
      snapshot.validUntil !== policy.validUntil ||
      !snapshot.recipients ||
      policy.recipients.some(
        (recipient) =>
          !snapshot.recipients!.some((allowed) =>
            sameAddress(recipient, allowed),
          ),
      )
    )
      throw new AppError(
        "POLICY_NOT_CONFIGURED",
        "Mandate text, limits, expiry, and recipients must match the on-chain policy.",
        409,
      );
  }
  async requestPayment(owner: string, input: unknown, treasuryId?: string, authority?: { agentId: string; keyVersion: number }) {
    const parsed = parsePayment(input);
    const timestamp = this.now();
    let result: Payment | undefined;
    const base = await this.store.read();
    const existingTreasury = this.treasury(base, owner, treasuryId);
    const existingPolicy = this.activePolicy(base, existingTreasury);
    const snapshot =
      this.mode === "live"
        ? await this.ports.settlement.snapshot(
            existingTreasury,
            existingPolicy.recipients,
          )
        : null;
    if (snapshot) this.assertSnapshotOwner(snapshot, owner);
    await this.store.update((s) => {
      const current = this.treasury(s, owner, treasuryId);
      if (authority && (current.agentId !== authority.agentId || current.keyVersion !== authority.keyVersion || !current.active))
        throw new AppError("UNAUTHORIZED", "Agent credential was revoked or rotated before this request was recorded.", 401);
      if (current.policyVersion !== existingTreasury.policyVersion ||
          current.keyVersion !== existingTreasury.keyVersion || current.paused !== existingTreasury.paused ||
          current.active !== existingTreasury.active)
        throw new AppError("POLICY_CHANGED", "Spending authority changed while validating this request. Refresh the mandate and retry.", 409);
      if (snapshot) {
        if (snapshot.policyVersion !== current.policyVersion)
          throw new AppError("POLICY_CHANGED", "The vault mandate changed. Register the new policy before requesting payment.", 409);
        this.assertSnapshotPolicy(snapshot, existingPolicy);
      }
      const t = snapshot
        ? {
            ...current,
            ...snapshot,
            week: snapshot.week ?? Math.floor(timestamp / 604800000),
          }
        : current;
      const p = this.activePolicy(s, t);
      const id = hashText(
        [t.id.toLowerCase(), t.agentId, parsed.idempotencyKey].join(":"),
      );
      const fingerprint = hashText(
        JSON.stringify({
          treasuryId: t.id.toLowerCase(),
          agentId: t.agentId,
          policyVersion: p.version,
          mandateHash: p.mandateHash,
          ...parsed,
          recipient: parsed.recipient.toLowerCase(),
        }),
      );
      const duplicate = s.payments.find((r) => r.id === id);
      if (duplicate) {
        if (duplicate.requestHash !== fingerprint)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key belongs to a different request.",
            409,
          );
        result = duplicate;
        return s;
      }
      checkLimits(s, t, p, parsed.amount, parsed.recipient, timestamp);
      result = {
        ...parsed,
        id,
        treasuryId: t.id,
        agentId: t.agentId,
        policyVersion: p.version,
        mandateHash: p.mandateHash,
        amountUnits: units(parsed.amount).toString(),
        requestHash: fingerprint,
        createdAt: new Date(timestamp).toISOString(),
        expiresAt: new Date(
          Math.min(timestamp + 3600000, p.validUntil * 1000),
        ).toISOString(),
        status: "queued",
        attempts: 0,
      };
      if (s.payments.length >= 1000)
        throw new AppError(
          "REQUEST_CAPACITY",
          "Prototype request capacity reached; export history before accepting more requests.",
          503,
        );
      return {
        ...s,
        treasuries: s.treasuries.map((x) => (x.id === t.id ? t : x)),
        payments: [...s.payments, result],
      };
    });
    return safePayment(result!);
  }
  async issueCredential(owner: string, treasuryId?: string) {
    const state = await this.store.read();
    const treasury = this.treasury(state, owner, treasuryId);
    if (this.mode === "live") {
      const snapshot = await this.ports.settlement.snapshot(
        treasury,
        this.activePolicy(state, treasury).recipients,
      );
      this.assertSnapshotOwner(snapshot, owner);
      if (!snapshot.active)
        throw new AppError(
          "AGENT_REVOKED",
          "The on-chain agent has been revoked.",
          403,
        );
    }
    const key = "ap_" + randomBytes(32).toString("base64url");
    let result:
      | { key: string; agentId: string; treasuryId: string; keyVersion: number }
      | undefined;
    await this.store.update((s) => {
      const t = this.treasury(s, owner, treasuryId);
      if (!t.active)
        throw new AppError(
          "AGENT_REVOKED",
          "Reactivate the agent before issuing credentials.",
          403,
        );
      const updated = { ...t, keyVersion: t.keyVersion + 1 };
      result = {
        key,
        agentId: t.agentId,
        treasuryId: t.id,
        keyVersion: updated.keyVersion,
      };
      return {
        ...s,
        treasuries: s.treasuries.map((x) => (x.id === t.id ? updated : x)),
        credentials: [
          ...s.credentials.filter((c) => c.treasuryId !== t.id),
          {
            digest: digest(key),
            treasuryId: t.id,
            agentId: t.agentId,
            keyVersion: updated.keyVersion,
            expiresAt: this.now() + 2592000000,
          },
        ],
      };
    });
    return result!;
  }
  async authenticateAgent(key: string) {
    if (!/^ap_[A-Za-z0-9_-]{43}$/.test(key))
      throw new AppError(
        "UNAUTHORIZED",
        "A valid agent credential is required.",
        401,
      );
    const s = await this.store.read();
    const credential = s.credentials.find(
      (c) => c.digest === digest(key) && c.expiresAt > this.now(),
    );
    const t = credential
      ? s.treasuries.find((t) => t.id === credential.treasuryId)
      : undefined;
    if (
      !credential ||
      !t ||
      !t.active ||
      t.keyVersion !== credential.keyVersion ||
      t.agentId !== credential.agentId
    )
      throw new AppError(
        "UNAUTHORIZED",
        "Agent credential is expired, revoked, or invalid.",
        401,
      );
    if (this.mode === "live") {
      const snapshot = await this.ports.settlement.snapshot(
        t,
        this.activePolicy(s, t).recipients,
      );
      this.assertSnapshotOwner(snapshot, t.owner);
      if (!snapshot.active)
        throw new AppError(
          "UNAUTHORIZED",
          "The on-chain agent has been revoked.",
          401,
        );
    }
    const fresh = await this.store.read();
    const current = fresh.treasuries.find((treasury) => treasury.id === t.id);
    if (!current || !current.active || current.keyVersion !== credential.keyVersion ||
        current.agentId !== credential.agentId || !sameAddress(current.owner, t.owner) ||
        !fresh.credentials.some((c) => c.digest === credential.digest && c.expiresAt > this.now()))
      throw new AppError("UNAUTHORIZED", "Agent credential was revoked or rotated during authorization.", 401);
    return { owner: current.owner, treasuryId: current.id, agentId: current.agentId, keyVersion: current.keyVersion };
  }
  async updatePolicy(owner: string, input: unknown, treasuryId?: string) {
    const next = parsePolicy(policyFields(input));
    if (next.validUntil * 1000 <= this.now())
      throw new AppError("POLICY_EXPIRED", "Choose a future mandate expiry.");
    const state = await this.store.read();
    const old = this.treasury(state, owner, treasuryId);
    const snapshot =
      this.mode === "live"
        ? await this.ports.settlement.snapshot(old, next.recipients)
        : null;
    if (snapshot) {
      this.assertSnapshotOwner(snapshot, owner);
      this.assertSnapshotPolicy(snapshot, next);
    }
    const version = snapshot?.policyVersion ?? old.policyVersion + 1;
    if (
      version <= old.policyVersion ||
      (snapshot && snapshot.mandateHash !== hashText(next.mandate))
    )
      throw new AppError(
        "POLICY_NOT_CONFIGURED",
        "Configure a higher mandate version on Aevum first.",
        409,
      );
    await this.store.update((s) => {
      const t = this.treasury(s, owner, treasuryId);
      if (t.policyVersion !== old.policyVersion)
        throw new AppError(
          "POLICY_CONFLICT",
          "The mandate changed; refresh before retrying.",
          409,
        );
      const updated = {
        ...t,
        ...snapshot,
        policyVersion: version,
        active: true,
      };
      return {
        ...s,
        treasuries: s.treasuries.map((x) => (x.id === t.id ? updated : x)),
        policies: [
          ...s.policies,
          {
            ...next,
            treasuryId: t.id,
            agentId: t.agentId,
            version,
            mandateHash: hashText(next.mandate),
          },
        ],
        payments: s.payments.map((r) =>
          r.treasuryId === t.id &&
          pending.has(r.status) &&
          r.status !== "executing"
            ? {
                ...r,
                status: "expired",
                error: "Mandate changed before execution.",
                leaseUntil: undefined,
              }
            : r,
        ),
      };
    });
    return this.dashboard(owner, treasuryId);
  }
  async control(owner: string, input: unknown, treasuryId?: string) {
    if (!input || typeof input !== "object")
      throw new AppError("INVALID_REQUEST", "An owner action is required.");
    const { action, amount } = input as Record<string, unknown>;
    if (
      !["fund", "withdraw", "pause", "resume", "revoke", "reactivate"].includes(
        String(action),
      )
    )
      throw new AppError("INVALID_ACTION", "Unknown treasury control.");
    let value = 0n;
    if (action === "fund" || action === "withdraw") {
      if (
        typeof amount !== "string" ||
        !/^([1-9]\d{0,12}|0)(\.\d{1,6})?$/.test(amount) ||
        units(amount) <= 0n
      )
        throw new AppError("INVALID_AMOUNT", "Enter a positive tUSD8 amount.");
      value = units(amount);
    }
    const base = await this.store.read();
    const old = this.treasury(base, owner, treasuryId);
    const snapshot =
      this.mode === "live"
        ? await this.ports.settlement.snapshot(
            old,
            this.activePolicy(base, old).recipients,
          )
        : null;
    await this.store.update((s) => {
      const t = this.treasury(s, owner, treasuryId);
      const oldPolicy = this.activePolicy(s, t);
      if (t.policyVersion !== old.policyVersion || t.keyVersion !== old.keyVersion ||
          t.paused !== old.paused || t.active !== old.active)
        throw new AppError("POLICY_CONFLICT", "Spending authority changed while confirming this control. Refresh and retry.", 409);
      let updated = { ...t };
      if (snapshot) {
        if (!sameAddress(snapshot.owner, owner))
          throw new AppError("UNAUTHORIZED", "Vault owner changed.", 403);
        const metadataAligned =
          snapshot.policyVersion === t.policyVersion &&
          snapshot.mandateHash === oldPolicy.mandateHash;
        updated = {
          ...t,
          ...snapshot,
          policyVersion: t.policyVersion,
          active: snapshot.active && metadataAligned,
          week: snapshot.week ?? Math.floor(this.now() / 604800000),
          keyVersion: action === "revoke" ? t.keyVersion + 1 : t.keyVersion,
        };
        if (action === "resume") {
          this.assertSnapshotPolicy(snapshot, oldPolicy);
          if (snapshot.policyVersion < t.policyVersion)
            throw new AppError(
              "POLICY_NOT_CONFIGURED",
              "The on-chain mandate version is older than the registered mandate.",
              409,
            );
          updated = {
            ...updated,
            policyVersion: snapshot.policyVersion,
            active: snapshot.active,
          };
        }
        if (
          (action === "pause" && !updated.paused) ||
          (action === "resume" && (snapshot.paused || !snapshot.active)) ||
          (action === "revoke" && snapshot.active)
        )
          throw new AppError(
            "CONTROL_NOT_CONFIRMED",
            "Confirm the owner action on Aevum before updating the dashboard.",
            409,
          );
      } else {
        if (action === "fund")
          updated = { ...t, balance: decimal(units(t.balance) + value) };
        if (action === "withdraw") {
          if (value > units(t.balance))
            throw new AppError(
              "INSUFFICIENT_BALANCE",
              "Withdrawal exceeds the treasury balance.",
            );
          updated = { ...t, balance: decimal(units(t.balance) - value) };
        }
        if (action === "pause") updated = { ...t, paused: true, active: false };
        if (action === "resume")
          updated = {
            ...t,
            paused: false,
            active: true,
            policyVersion: t.policyVersion + 1,
          };
        if (action === "revoke")
          updated = { ...t, active: false, keyVersion: t.keyVersion + 1 };
        if (action === "reactivate")
          throw new AppError(
            "POLICY_REQUIRED",
            "Save a new mandate version to reactivate the agent.",
            409,
          );
      }
      const invalidate = action === "pause" || action === "revoke";
      const nextPolicy =
        action === "resume" && updated.policyVersion > t.policyVersion
          ? { ...oldPolicy, version: updated.policyVersion }
          : null;
      return {
        ...s,
        policies: nextPolicy ? [...s.policies, nextPolicy] : s.policies,
        treasuries: s.treasuries.map((x) => (x.id === t.id ? updated : x)),
        payments: invalidate
          ? s.payments.map((r) =>
              r.treasuryId === t.id &&
              pending.has(r.status) &&
              r.status !== "executing"
                ? {
                    ...r,
                    status: "expired",
                    error: "Owner suspended spending authority.",
                    leaseUntil: undefined,
                  }
                : r,
            )
          : s.payments,
      };
    });
    return this.dashboard(owner, treasuryId);
  }
  async processBatch(limit = 5) {
    return new PaymentProcessor(this.store, this.ports, this.mode).processBatch(
      limit,
    );
  }
}
