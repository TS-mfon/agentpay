import type { State, Treasury, Policy } from "./types";
import { AppError } from "./errors";
import { units, decimal, sameAddress } from "./validation";
export const pendingStatuses = new Set([
  "queued",
  "evaluating",
  "awaiting_finality",
  "approved",
  "executing",
]);
export function checkLimits(
  s: State,
  t: Treasury,
  p: Policy,
  amount: string,
  recipient: string,
  timestamp: number,
  excludeId?: string,
) {
  if (t.paused)
    throw new AppError(
      "TREASURY_PAUSED",
      "The owner has paused this treasury.",
      409,
    );
  if (!t.active)
    throw new AppError(
      "AGENT_REVOKED",
      "This agent no longer has spending authority.",
      403,
    );
  if (p.validUntil * 1000 <= timestamp)
    throw new AppError(
      "POLICY_EXPIRED",
      "The financial mandate has expired.",
      409,
    );
  if (!p.recipients.some((r) => sameAddress(r, recipient)))
    throw new AppError(
      "RECIPIENT_NOT_ALLOWED",
      "This recipient is not approved.",
      403,
    );
  const value = units(amount);
  if (value > units(p.perPaymentLimit))
    throw new AppError(
      "PAYMENT_LIMIT",
      "Payment exceeds the per-payment limit.",
    );
  const reserved = reservedUnits(s, t.id, timestamp, excludeId);
  const spent =
    t.week === Math.floor(timestamp / 604800000) ? units(t.weeklySpent) : 0n;
  if (value + reserved + spent > units(p.weeklyBudget))
    throw new AppError(
      "WEEKLY_BUDGET",
      "Payment exceeds the available weekly budget.",
    );
  if (value + reserved + units(t.totalSpent) > units(p.totalBudget))
    throw new AppError(
      "TOTAL_BUDGET",
      "Payment exceeds the remaining total budget.",
    );
  if (value + reserved > units(t.balance))
    throw new AppError(
      "INSUFFICIENT_BALANCE",
      "Treasury has insufficient available funds.",
    );
}

export function reservedUnits(s: State, treasuryId: string, timestamp: number, excludeId?: string): bigint {
  return s.payments.filter((r) => r.id !== excludeId && sameAddress(r.treasuryId, treasuryId) &&
    pendingStatuses.has(r.status) && (r.status === "executing" || Date.parse(r.expiresAt) > timestamp))
    .reduce((total, r) => total + BigInt(r.amountUnits), 0n);
}
export function spendingAvailability(s: State, t: Treasury, p: Policy, timestamp: number) {
  const reserved = reservedUnits(s, t.id, timestamp);
  const nonNegative = (amount: bigint) => amount > 0n ? amount : 0n;
  const available = nonNegative(units(t.balance) - reserved);
  const spentThisWeek = t.week === Math.floor(timestamp / 604800000) ? units(t.weeklySpent) : 0n;
  const weekly = nonNegative(units(p.weeklyBudget) - spentThisWeek - reserved);
  const total = nonNegative(units(p.totalBudget) - units(t.totalSpent) - reserved);
  const spendable = !t.active || t.paused || p.validUntil * 1000 <= timestamp ? 0n :
    [available, weekly, total].reduce((minimum, value) => value < minimum ? value : minimum);
  return { reservedBalance: decimal(reserved), availableBalance: decimal(available),
    availableWeeklyBudget: decimal(weekly), availableTotalBudget: decimal(total), spendableBalance: decimal(spendable) };
}
