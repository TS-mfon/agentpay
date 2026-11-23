import type { State, Treasury, Policy } from "./types";
import { AppError } from "./errors";
import { units, sameAddress } from "./validation";
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
  const reserved = s.payments
    .filter(
      (r) =>
        r.id !== excludeId &&
        r.treasuryId === t.id &&
        pendingStatuses.has(r.status) &&
        Date.parse(r.expiresAt) > timestamp,
    )
    .reduce((total, r) => total + BigInt(r.amountUnits), 0n);
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
