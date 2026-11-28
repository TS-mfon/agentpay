import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const reference = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const nonNegativeInteger = z.number().int().nonnegative();

export const agentPaymentSchema = z.object({
  id: reference.describe("AgentPay request ID"),
  treasuryId: address,
  agentId: reference,
  recipient: address,
  amount: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/),
  amountUnits: z.string().regex(/^\d+$/).describe("Integer tUSD8 base units"),
  idempotencyKey: z.string(),
  policyVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: z.enum(["queued", "evaluating", "awaiting_finality", "approved", "rejected",
    "needs_information", "executing", "settled", "expired", "failed"]),
  attempts: nonNegativeInteger,
  lastAttemptAt: nonNegativeInteger.nullable().optional(),
  retryAt: nonNegativeInteger.nullable().optional(),
  consecutiveFailures: nonNegativeInteger.nullable().optional(),
  transactionHash: reference.optional().describe("Aevum transaction reference. Verify the receipt for settled payments."),
  requestHash: reference.optional().describe("Purchase binding disclosed with an Aevum settlement receipt"),
}).refine(payment => payment.status !== "settled" || !payment.transactionHash || !!payment.requestHash, {
  path: ["requestHash"],
  message: "An Aevum settlement receipt requires the purchase binding",
});

/** Public projection for both stored records and older upstream API responses. */
export function agentPayment(record: unknown) {
  if (typeof record !== "object" || record === null) return agentPaymentSchema.parse(record);
  const payment = record as Record<string, unknown>;
  const hash = reference.safeParse(payment.transactionHash);
  return agentPaymentSchema.parse({
    ...payment,
    transactionHash: hash.data,
    requestHash: hash.success && payment.status === "settled" ? payment.requestHash : undefined,
  });
}
