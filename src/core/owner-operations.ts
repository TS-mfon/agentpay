import type { Address, Hex } from "viem";
import type { Policy, State } from "./types";
import { AppError } from "./errors";
import { sameAddress } from "./validation";

export type OwnerMandate = Omit<Policy, "treasuryId" | "agentId" | "version" | "mandateHash">;
export type OwnerIntent = { treasuryId: string; agentId: string } & (
  | { action: "setup"; agentName: string; version: number; policy: OwnerMandate }
  | { action: "policy" | "resume"; version: number; policy: OwnerMandate }
  | { action: "pause" | "revoke"; version: number }
  | { action: "fund" | "withdraw"; amount: string }
);

export interface SignedOwnerOperation {
  sender: Address;
  nonce: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  signature: Hex;
}

export interface OwnerOperationStatus {
  treasuryId: string;
  action: OwnerIntent["action"];
  userOperationHash: Hex;
  status: "pending" | "confirmed" | "failed" | "review";
  transactionHash?: Hex;
  error?: string;
  agentName?: string;
}

export interface OwnerOperationRecord {
  hash: Hex;
  owner: string;
  intent: OwnerIntent;
  status: OwnerOperationStatus["status"];
  operation?: SignedOwnerOperation;
  nextBlock: string;
  transactionHash?: Hex;
  error?: string;
}

export interface OwnerOperationConfirmation {
  hash: Hex;
  transactionHash: Hex;
  version?: number;
}

export function finishOwnerOperation(state: State, owner: string, hash: Hex,
  outcome: Pick<OwnerOperationRecord, "status" | "transactionHash" | "error">) {
  const entries = state.ownerOperations ?? [];
  const record = entries.find(entry => sameAddress(entry.owner, owner) && entry.hash === hash);
  if (!record || record.status !== "pending") return state;
  const { operation: _operation, ...previous } = record;
  // Only a pending operation may update treasury metadata. Retain recent outcomes for retries.
  const history = entries.filter(entry => entry !== record);
  const pending = history.filter(entry => entry.status === "pending");
  const recent = history.filter(entry => entry.status !== "pending").slice(-255);
  return { ...state, ownerOperations: [...pending, ...recent, { ...previous, ...outcome }] };
}

export function ownerOperationPending(state: State, owner: string, hash: Hex) {
  return (state.ownerOperations ?? []).some(entry => entry.hash === hash &&
    entry.status === "pending" && sameAddress(entry.owner, owner));
}

export function assertOwnerOperationVersion(actual: number, expected?: number) {
  if (expected !== undefined && actual !== expected)
    throw new AppError("OWNER_OPERATION_STALE", "The treasury’s mandate has changed since this operation was signed.", 409);
}
