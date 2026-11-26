import { z } from "zod";
import {
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  parseUnits,
  formatUnits,
} from "viem";
import { AppError } from "./errors";
import type { PaymentInput } from "./types";
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((value) => isAddress(value, { strict: true }) && !/^0x0{40}$/i.test(value), "Address checksum is invalid or address is zero")
  .transform((s) => getAddress(s));
export const tokenAmountSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,12})(\.\d{1,6})?$/,
    "Use a positive amount with up to six decimals",
  )
  .refine((s) => {
    try {
      return parseUnits(s, 6) > 0n;
    } catch {
      return false;
    }
  }, "Amount must be positive");
export const paymentSchema = z
  .object({
    recipient: address,
    amount: tokenAmountSchema,
    service: z.string().trim().min(1).max(120),
    purpose: z.string().trim().min(3).max(1000),
    evidence: z.string().trim().max(4000).default(""),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  })
  .strict();
export const policySchema = z
  .object({
    mandate: z.string().trim().min(10).max(4000),
    perPaymentLimit: tokenAmountSchema,
    weeklyBudget: tokenAmountSchema,
    totalBudget: tokenAmountSchema,
    validUntil: z.number().int().positive().max(4102444800),
    recipients: z.array(address).min(1).max(30),
  })
  .strict()
  .refine(
    (p) =>
      units(p.perPaymentLimit) <= units(p.weeklyBudget) &&
      units(p.weeklyBudget) <= units(p.totalBudget),
    "Limits must satisfy per-payment <= weekly <= total",
  );
export const units = (value: string) => parseUnits(value, 6);
export const decimal = (value: bigint) => formatUnits(value, 6);
export const hashText = (value: string) => keccak256(stringToHex(value));
export const parsePayment = (input: unknown): PaymentInput => {
  const result = paymentSchema.safeParse(input);
  if (!result.success)
    throw new AppError(
      "INVALID_REQUEST",
      "Payment fields are invalid. Use a positive tUSD8 amount, valid address, and an 8–100 character idempotency key.",
    );
  return { ...result.data, amount: decimal(units(result.data.amount)) };
};
export function parsePolicy(input: unknown) {
  const result = policySchema.safeParse(input);
  if (!result.success)
    throw new AppError(
      "INVALID_POLICY",
      "Mandate, limits, recipients, or expiry are invalid.",
    );
  return {
    ...result.data,
    perPaymentLimit: decimal(units(result.data.perPaymentLimit)),
    weeklyBudget: decimal(units(result.data.weeklyBudget)),
    totalBudget: decimal(units(result.data.totalBudget)),
    recipients: [...new Set(result.data.recipients)],
  };
}
export const sameAddress = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

export function policyFields(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const { txHash, ...fields } = input as Record<string, unknown>;
  if (
    txHash !== undefined &&
    (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash))
  )
    throw new AppError(
      "INVALID_RECEIPT",
      "Transaction reference must be a 32-byte hexadecimal hash.",
    );
  return fields;
}
