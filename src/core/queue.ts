import type { Payment, State } from "./types";

export const WORKER_LEASE_MS = 420000;
export const POLL_INTERVAL_MS = 10000;
export const MAX_TRANSIENT_FAILURES = 6;
const expirable = new Set(["queued", "evaluating", "awaiting_finality", "approved"]);

/** Financial expiry releases admission reservations, never an unresolved chain write. */
export function expireRequests(state: State, now: number): State {
  return { ...state, payments: state.payments.map(payment => {
    if ((payment.status === "expired" || payment.status === "failed") && payment.decisionRef &&
      !payment.decisionReason && payment.governanceUnresolved === undefined)
      return { ...payment, governanceUnresolved: true };
    if (!expirable.has(payment.status) || Date.parse(payment.expiresAt) > now) return payment;
    return { ...payment, status: "expired" as const, leaseUntil: undefined, retryAt: undefined,
      governanceUnresolved: payment.governanceUnresolved || payment.status === "awaiting_finality",
      error: "Payment authorization expired." };
  }) };
}

export function governancePending(payment: Payment): boolean {
  return payment.governanceUnresolved === true || !!payment.policyRegistration ||
    (payment.status === "awaiting_finality" && payment.governanceUnresolved !== false);
}

export function isTerminal(payment: Payment): boolean {
  return ["failed", "expired", "rejected", "needs_information", "settled"].includes(payment.status);
}

export function selectDueRequest(state: State, now: number): Payment | undefined {
  const due = state.payments.filter(p => (p.leaseUntil ?? 0) <= now && (p.retryAt ?? 0) <= now)
    .sort((a, b) => (a.lastAttemptAt ?? 0) - (b.lastAttemptAt ?? 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const executorPending = state.payments.some(p => p.status === "executing");
  const pendingGovernance = state.payments.some(governancePending);
  return due.find(p => p.status === "executing") ??
    (!executorPending ? due.find(p => p.status === "approved") : undefined) ??
    due.find(p => p.status === "awaiting_finality") ??
    due.find(p => p.status === "evaluating" && !!p.policyRegistration) ??
    due.find(p => isTerminal(p) && governancePending(p)) ??
    (!pendingGovernance ? due.find(p => p.status === "evaluating") ?? due.find(p => p.status === "queued") : undefined);
}

export function retryDelay(payment: Payment, failures: number): number {
  const base = Math.min(300000, 15000 * 2 ** Math.min(5, Math.max(0, failures - 1)));
  const entropy = Number.parseInt(payment.id.slice(-2), 16) || 0;
  return Math.min(300000, base + Math.floor(base * (entropy % 25) / 100));
}
