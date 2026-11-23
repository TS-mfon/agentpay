import { createClient, createAccount, isSuccessful } from "genlayer-js";
import { governanceChain } from "./genlayer-network";
import { TransactionHashVariant, TransactionStatus } from "genlayer-js/types";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";
import type { Governance } from "../core/ports";
import type { Policy } from "../core/types";

export const decisionSchema = z.object({
  request_id: z.string(),
  policy_key: z.string(),
  policy_version: z.number().int().positive(),
  request_hash: z.string().regex(/^0x[0-9a-f]{64}$/),
  mandate_hash: z.string().regex(/^0x[0-9a-f]{64}$/),
  status: z.enum(["approved", "rejected", "needs_information"]),
  reason: z.string().min(5).max(1200),
});
export const policyKey = (policy: Policy) =>
  `${policy.treasuryId.toLowerCase()}:${policy.agentId.toLowerCase()}:${policy.version}`;
export function createGenLayerGovernance(): Governance {
  const address = process.env.GENLAYER_CONTRACT_ADDRESS;
  if (!address || !isAddress(address))
    throw new Error("Configure GENLAYER_CONTRACT_ADDRESS");
  const contract = address as Address;
  const chain = governanceChain();
  const key = process.env.GENLAYER_OPERATOR_PRIVATE_KEY;
  if (key && (!isHex(key) || key.length !== 66))
    throw new Error("Invalid governance operator key");
  const client = createClient({
    chain,
    endpoint: process.env.GENLAYER_RPC_URL || undefined,
    account: key ? createAccount(key as Hex) : undefined,
  });
  const reader = async (functionName: string, args: string[]) =>
    client.readContract({
      address: contract,
      functionName,
      args,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      jsonSafeReturn: true,
    });
  return {
    async register(policy) {
      const existing = await reader("get_policy", [policyKey(policy)]);
      if (typeof existing === "string" && existing) {
        const record = JSON.parse(existing) as {
          mandate_hash: string;
          text: string;
        };
        if (
          record.mandate_hash !== policy.mandateHash ||
          record.text !== policy.mandate
        )
          throw new Error("Finalized policy does not match owner mandate");
        return;
      }
      if (!key)
        throw new Error("Policy registration requires the governance worker");
      const estimate = await client.estimateTransactionFees();
      const tx = await client.writeContract({
        fees: {
          distribution: estimate.distribution,
          feeValue: estimate.feeValue,
        },
        address: contract,
        functionName: "register_policy",
        args: [
          policy.treasuryId.toLowerCase(),
          policy.agentId.toLowerCase(),
          policy.version,
          policy.mandateHash,
          policy.mandate,
        ],
      });
      const receipt = await client.waitForTransactionReceipt({
        hash: tx,
        waitUntil: "finalized",
        interval: 5_000,
        retries: 36,
      });
      if (!isSuccessful(receipt))
        throw new Error("Policy registration failed to finalize successfully");
    },
    async submit(policy, payment) {
      if (!key)
        throw new Error(
          "Governance evaluation is available only on the worker",
        );
      const request = JSON.stringify({
        service: payment.service,
        purpose: payment.purpose,
        evidence: payment.evidence,
        recipient: payment.recipient,
        amount: payment.amount,
        token: "tUSD8",
        request_id: payment.id,
        policy_version: payment.policyVersion,
      });
      const estimate = await client.estimateTransactionFees();
      const tx = await client.writeContract({
        fees: {
          distribution: estimate.distribution,
          feeValue: estimate.feeValue,
        },
        address: contract,
        functionName: "evaluate",
        args: [payment.id, policyKey(policy), payment.requestHash, request],
      });
      if (typeof tx !== "string" || !isHex(tx) || tx.length !== 66)
        throw new Error("Governance did not return a transaction hash");
      return tx;
    },
    async inspect(reference, payment) {
      if (!isHex(reference) || reference.length !== 66)
        throw new Error("Invalid governance decision transaction");
      const transaction = await client.getTransaction({
        hash: reference as Parameters<typeof client.getTransaction>[0]["hash"],
      });
      if (transaction.statusName !== TransactionStatus.FINALIZED)
        return {
          finalized: false,
          status: "pending",
          reason: "Waiting for GenLayer finality",
          requestHash: payment.requestHash,
          mandateHash: payment.mandateHash,
        };
      if (!isSuccessful(transaction))
        throw new Error(
          "GenLayer evaluation finalized with an execution error",
        );
      const encoded = await reader("get_decision", [payment.id]);
      if (typeof encoded !== "string" || !encoded)
        throw new Error("Finalized decision record is unavailable");
      const decision = decisionSchema.parse(JSON.parse(encoded));
      const expectedKey = `${payment.treasuryId.toLowerCase()}:${payment.agentId.toLowerCase()}:${payment.policyVersion}`;
      if (
        decision.request_id !== payment.id ||
        decision.policy_key !== expectedKey ||
        decision.policy_version !== payment.policyVersion ||
        decision.request_hash !== payment.requestHash ||
        decision.mandate_hash !== payment.mandateHash
      )
        throw new Error("Decision binding mismatch");
      return {
        finalized: true,
        status: decision.status,
        reason: decision.reason,
        requestHash: decision.request_hash,
        mandateHash: decision.mandate_hash,
      };
    },
  };
}
