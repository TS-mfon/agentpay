import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const reference = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const money = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/);
const nullableReference = reference.nullable().optional();
const optionalText = z.string().nullable().optional();
const iso = z.iso.datetime();
const authorizationFields = {
  validUntil: z.number().int().positive().optional().describe("Authorization expiry as Unix seconds, not milliseconds"),
  authorizationExpiresAt: iso.optional().describe("ISO UTC form of validUntil, when returned"),
};
export const treasuryOutput = z.object({
  id: address.describe("Owner-controlled Aevum vault address"),
  owner: address,
  executor: address,
  token: address.describe("Settlement-token contract; compare to the configured Aevum tUSD8 token"),
  agentId: reference,
  agentName: z.string(),
  balance: money.describe("Raw on-chain tUSD8 balance; pending commitments may reduce availableBalance"),
  reservedBalance: money.optional().describe("tUSD8 committed to eligible pending requests, including unresolved submitted transactions"),
  availableBalance: money.optional().describe("Raw balance minus pending commitments; absent on older API deployments, not assumed equal to balance"),
  availableWeeklyBudget: money.optional(),
  availableTotalBudget: money.optional(),
  spendableBalance: money.optional().describe("Minimum remaining balance, weekly budget and lifetime budget after commitments"),
  weeklySpent: money,
  totalSpent: money,
  active: z.boolean(),
  paused: z.boolean(),
  policyVersion: z.number().int().positive(),
  keyVersion: z.number().int().nonnegative(),
  week: z.number().int().nonnegative().optional(),
  mandateHash: reference.optional(),
  perPaymentLimit: money.optional(),
  weeklyBudget: money.optional(),
  totalBudget: money.optional(),
  recipients: z.array(address).optional(),
  ...authorizationFields,
});
export const policyOutput = z.object({
  treasuryId: address,
  agentId: reference,
  version: z.number().int().positive(),
  mandate: z.string(),
  mandateHash: reference,
  perPaymentLimit: money,
  weeklyBudget: money,
  totalBudget: money,
  validUntil: z.number().int().positive().describe("Authorization expiry as Unix seconds, not milliseconds"),
  authorizationExpiresAt: iso.optional(),
  recipients: z.array(address).min(1).describe("Owner-approved addresses; the API does not establish merchant identity or invoice authenticity"),
});
export const paymentOutput = z.object({
  id: reference.describe("AgentPay request ID; distinct from decisionRef and transactionHash"),
  treasuryId: address,
  agentId: reference,
  recipient: address,
  amount: money,
  amountUnits: z.string().regex(/^\d+$/).describe("Integer tUSD8 base units: amount multiplied by 1000000"),
  service: z.string(),
  purpose: z.string(),
  evidence: z.string(),
  idempotencyKey: z.string(),
  policyVersion: z.number().int().positive(),
  mandateHash: reference,
  requestHash: reference,
  createdAt: iso,
  expiresAt: iso,
  status: z.enum(["queued", "evaluating", "awaiting_finality", "approved", "rejected", "needs_information", "executing", "settled", "expired", "failed"]),
  attempts: z.number().int().nonnegative(),
  leaseUntil: z.number().int().nonnegative().nullable().optional(),
  decisionRef: nullableReference.describe("GenLayer evaluation transaction hash, when submitted"),
  evaluationReferences: z.array(reference).nullable().optional(),
  evaluationRecoveryAttempts: z.number().int().nonnegative().nullable().optional(),
  decisionReason: optionalText,
  approvalExpiresAt: z.number().int().positive().nullable().optional(),
  transactionHash: nullableReference.describe("Aevum settlement transaction; a hash alone is not a successful receipt"),
  error: optionalText,
}).superRefine((payment, context) => {
  if (payment.status !== "settled") return;
  for (const field of ["transactionHash", "decisionRef"] as const) {
    if (!payment[field]) context.addIssue({ code: "custom", path: [field], message: "A settled record requires its transaction and decision references" });
  }
});
export const historyOutput = z.array(paymentOutput);
export const successOutput = <T extends z.ZodType>(data: T) => z.object({success: z.literal(true), data});

export function withAuthorizationDate(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("validUntil" in value)) return value;
  const seconds = value.validUntil;
  if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 4102444800) return value;
  return {...value, authorizationExpiresAt: new Date(seconds * 1000).toISOString()};
}
