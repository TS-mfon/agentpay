import type { PaymentStatus, Policy } from "./types";
function units(value: string): bigint | null {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
export function formatMoney(value: string): string {
  const amount = units(value);
  if (amount === null) return "Unavailable";
  const whole = (amount / 1_000_000n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${whole}.${fraction}`;
}
export function budgetPercent(spent: string, budget: string): number {
  const used = units(spent);
  const maximum = units(budget);
  if (used === null || maximum === null || maximum === 0n) return 0;
  const percent = (used * 100n) / maximum;
  return Number(percent > 100n ? 100n : percent);
}
export function remainingBudget(budget: string, spent: string): string {
  const maximum = units(budget);
  const used = units(spent);
  if (maximum === null || used === null) return "0";
  const remaining = maximum > used ? maximum - used : 0n;
  return (
    `${remaining / 1_000_000n}.${(remaining % 1_000_000n).toString().padStart(6, "0")}`.replace(
      /\.?0+$/,
      "",
    ) || "0"
  );
}
const labels: Record<PaymentStatus, string> = {
  queued: "Queued",
  evaluating: "Evaluating policy",
  awaiting_finality: "Awaiting finality",
  approved: "Approved",
  rejected: "Rejected",
  needs_information: "Needs information",
  executing: "Executing payment",
  settled: "Settled",
  expired: "Expired",
  failed: "Failed",
};
export const statusLabel = (status: PaymentStatus): string =>
  labels[status] ?? status;
export function paymentStage(status: PaymentStatus): number {
  if (status === "settled") return 4;
  if (status === "executing") return 3;
  if (status === "approved" || status === "awaiting_finality") return 2;
  if (
    status === "evaluating" ||
    status === "rejected" ||
    status === "needs_information"
  )
    return 1;
  return 0;
}
export function shorten(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function policyPayload(
  policy: Omit<Policy, "version" | "mandateHash">,
): Omit<Policy, "version" | "mandateHash"> {
  return {
    mandate: policy.mandate.trim(),
    perPaymentLimit: policy.perPaymentLimit,
    weeklyBudget: policy.weeklyBudget,
    totalBudget: policy.totalBudget,
    validUntil: policy.validUntil,
    recipients: [...policy.recipients],
  };
}
