import { AppError } from "../core/errors";
import { createClient, createAccount, isSuccessful } from "genlayer-js";
import { governanceChain } from "./genlayer-network";
import { TransactionHashVariant, TransactionStatus } from "genlayer-js/types";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";
import type { Governance, GovernanceSubmission, SignedGovernanceTransaction } from "../core/ports";
import type { Policy } from "../core/types";
import { isMissingGovernanceTransaction, journaledAccount, validateSignedGovernance } from "./genlayer-signing";

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
export function createGenLayerGovernance(options: { endpoint?: string } = {}): Governance {
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
    endpoint: options.endpoint || process.env.GENLAYER_RPC_URL || undefined,
    account: key ? createAccount(key as Hex) : undefined,
  });
  const writer = (submission?: GovernanceSubmission) => {
    let preparedReference: string | undefined;
    const onPrepared = submission?.onPrepared;
    const journal = onPrepared ? async (prepared: SignedGovernanceTransaction) => {
      await onPrepared(prepared);
      preparedReference = prepared.reference;
    } : undefined;
    return {
      signer: createClient({
        chain,
        endpoint: options.endpoint || process.env.GENLAYER_RPC_URL || undefined,
        account: key ? journaledAccount(createAccount(key as Hex), chain.isStudio === true, journal) : undefined,
      }),
      verifyReference(reference: string) {
        if (preparedReference && reference !== preparedReference)
          throw new AppError("GOVERNANCE_REFERENCE_MISMATCH", "RPC returned a different governance envelope reference.", 503);
      },
    };
  };
  const rebroadcast = async (prepared: SignedGovernanceTransaction) => {
    const saved = validateSignedGovernance(prepared, chain.isStudio === true);
    const hash = await client.sendRawTransaction({ serializedTransaction: saved.rawTransaction });
    if (hash !== saved.reference)
      throw new AppError("GOVERNANCE_REFERENCE_MISMATCH", "RPC returned a different governance envelope reference.", 503);
    return saved.reference;
  };
  const recoverPrepared = async (prepared: SignedGovernanceTransaction) => {
    const saved = validateSignedGovernance(prepared, chain.isStudio === true);
    try {
      const existing = await client.getTransaction({ hash: saved.reference as Parameters<typeof client.getTransaction>[0]["hash"] });
      if (existing) return saved.reference;
    } catch (error) {
      if (!isMissingGovernanceTransaction(error)) throw error;
    }
    return rebroadcast(saved);
  };
  const reader = async (functionName: string, args: string[]) =>
    client.readContract({
      address: contract,
      functionName,
      args,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      jsonSafeReturn: true,
    });
  return {
    async register(policy, submission) {
      const existing = await reader("get_policy", [policyKey(policy)]);
      if (typeof existing === "string" && existing) {
        let record: { mandate_hash: string; text: string };
        try { record = JSON.parse(existing); }
        catch { throw new AppError("POLICY_RECORD_MALFORMED", "Finalized policy record is malformed.", 503); }
        if (
          record.mandate_hash !== policy.mandateHash ||
          record.text !== policy.mandate
        )
          throw new AppError("POLICY_RECORD_MISMATCH", "Finalized policy does not match owner mandate", 409);
        if (submission?.prepared) {
          const reference = await recoverPrepared(submission.prepared);
          const receipt = await client.waitForTransactionReceipt({
            hash: reference as Parameters<typeof client.waitForTransactionReceipt>[0]["hash"],
            waitUntil: "finalized",
            interval: 5_000,
            retries: 36,
          });
          if (!isSuccessful(receipt))
            throw new AppError("POLICY_REGISTRATION_FAILED", "Policy registration failed to finalize successfully", 503);
        }
        return;
      }
      if (!key)
        throw new Error("Policy registration requires the governance worker");
      const { signer, verifyReference } = writer(submission);
      const estimate = submission?.prepared ? undefined : await signer.estimateTransactionFees();
      const tx = submission?.prepared ? await recoverPrepared(submission.prepared) : await signer.writeContract({
        fees: {
          distribution: estimate!.distribution,
          feeValue: estimate!.feeValue,
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
      verifyReference(tx);
      const receipt = await client.waitForTransactionReceipt({
        hash: tx,
        waitUntil: "finalized",
        interval: 5_000,
        retries: 36,
      });
      if (!isSuccessful(receipt))
        throw new AppError("POLICY_REGISTRATION_FAILED", "Policy registration failed to finalize successfully", 503);
    },
    async submit(policy, payment, submission) {
      if (!key)
        throw new Error(
          "Governance evaluation is available only on the worker",
        );
      if (submission?.prepared) return recoverPrepared(submission.prepared);
      const { signer, verifyReference } = writer(submission);
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
      const estimate = await signer.estimateTransactionFees();
      const tx = await signer.writeContract({
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
      verifyReference(tx);
      return tx;
    },
    async inspect(reference, payment) {
      if (!isHex(reference) || reference.length !== 66)
        throw new Error("Invalid governance decision transaction");
      let transaction;
      try {
        transaction = await client.getTransaction({
          hash: reference as Parameters<typeof client.getTransaction>[0]["hash"],
        });
      } catch (error) {
        if (!payment.rawGovernanceTransaction || !isMissingGovernanceTransaction(error)) throw error;
        await rebroadcast({ reference, rawTransaction: payment.rawGovernanceTransaction });
        return {
          finalized: false, status: "pending", reason: "Saved governance transaction resubmitted; waiting for finality.",
          requestHash: payment.requestHash, mandateHash: payment.mandateHash,
        };
      }
      if (transaction.statusName !== TransactionStatus.FINALIZED)
        return {
          finalized: false,
          status: "pending",
          reason: "Waiting for GenLayer finality",
          requestHash: payment.requestHash,
          mandateHash: payment.mandateHash,
        };
      if (!isSuccessful(transaction))
        throw new AppError("EVALUATION_FAILED", "GenLayer evaluation finalized with an execution error. No payment was authorized.", 503);
      const encoded = await reader("get_decision", [payment.id]);
      if (encoded === "" || encoded == null)
        return { finalized: true, status: "unavailable", reason: "Finalized decision record is unavailable.",
          requestHash: payment.requestHash, mandateHash: payment.mandateHash };
      let decoded: unknown;
      try { decoded = typeof encoded === "string" ? JSON.parse(encoded) : null; }
      catch { throw new AppError("EVALUATION_MALFORMED", "Finalized decision record is malformed. No payment was authorized.", 503); }
      const parsed = decisionSchema.safeParse(decoded);
      if (!parsed.success) throw new AppError("EVALUATION_MALFORMED", "Finalized decision record is malformed. No payment was authorized.", 503);
      const decision = parsed.data;
      const expectedKey = `${payment.treasuryId.toLowerCase()}:${payment.agentId.toLowerCase()}:${payment.policyVersion}`;
      if (
        decision.request_id !== payment.id ||
        decision.policy_key !== expectedKey ||
        decision.policy_version !== payment.policyVersion ||
        decision.request_hash !== payment.requestHash ||
        decision.mandate_hash !== payment.mandateHash
      )
        throw new AppError("DECISION_MISMATCH", "Decision binding mismatch. No payment was authorized.", 409);
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
