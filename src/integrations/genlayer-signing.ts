import { createAccount } from "genlayer-js";
import { isHex, keccak256, type Hex } from "viem";
import { AppError } from "../core/errors";
import type { GovernanceSubmission, SignedGovernanceTransaction } from "../core/ports";

type LocalAccount = ReturnType<typeof createAccount>;

/** Studio consensus references are the hash of the signed EVM envelope. */
export function journaledAccount(
  account: LocalAccount,
  isStudio: boolean,
  onPrepared?: GovernanceSubmission["onPrepared"],
): LocalAccount {
  if (!onPrepared) return account;
  requireStudioJournal(isStudio);
  const sign = account.signTransaction;
  const signTransaction = async (...parameters: Parameters<typeof sign>) => {
    const rawTransaction = await sign(...parameters);
    await onPrepared({ reference: keccak256(rawTransaction), rawTransaction });
    return rawTransaction;
  };
  // The wrapper forwards the same generic input and returns the exact serializer output.
  return { ...account, signTransaction: signTransaction as typeof sign };
}

export function requireStudioJournal(isStudio: boolean): void {
  if (!isStudio)
    throw new AppError(
      "GOVERNANCE_JOURNAL_UNSUPPORTED",
      "Durable governance signing requires Studio envelope references on this deployment.",
      503,
    );
}

export function validateSignedGovernance(
  prepared: SignedGovernanceTransaction,
  isStudio: boolean,
): { reference: Hex; rawTransaction: Hex } {
  requireStudioJournal(isStudio);
  const { reference, rawTransaction } = prepared;
  if (
    !isHex(reference) || reference.length !== 66 ||
    !isHex(rawTransaction) || rawTransaction.length <= 2 ||
    rawTransaction.length % 2 !== 0 || rawTransaction.length > 2_000_002 ||
    keccak256(rawTransaction) !== reference
  )
    throw new AppError(
      "INVALID_GOVERNANCE_JOURNAL",
      "Saved governance transaction does not match its reference. No new write was sent.",
      409,
    );
  return { reference, rawTransaction };
}

/** Only specific missing-transaction errors permit an exact-byte rebroadcast. */
export function isMissingGovernanceTransaction(error: unknown): boolean {
  let candidate = error;
  for (let depth = 0; depth < 6; depth++) {
    if (!candidate || typeof candidate !== "object") return false;
    const { name, cause } = candidate as { name?: unknown; cause?: unknown };
    if (name === "TransactionNotFoundError" || name === "ResourceNotFoundRpcError") return true;
    candidate = cause;
  }
  return false;
}
