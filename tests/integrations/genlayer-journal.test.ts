import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import type { Payment, Policy } from "../../src/core/types";

const mock = vi.hoisted(() => ({
  readContract: vi.fn(),
  writeContract: vi.fn(),
  getTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  estimateTransactionFees: vi.fn(),
  sendRawTransaction: vi.fn(),
  signTransaction: vi.fn(),
  success: vi.fn(),
  clients: [] as Array<{ account?: { signTransaction: (...args: unknown[]) => Promise<string> }; endpoint?: string }>,
}));
vi.mock("genlayer-js", () => ({
  createClient: (configuration: (typeof mock.clients)[number]) => {
    mock.clients.push(configuration);
    return { ...mock, writeContract: (...args: unknown[]) => mock.writeContract(configuration, ...args) };
  },
  createAccount: () => ({ address: "operator", type: "local", signTransaction: mock.signTransaction }),
  isSuccessful: mock.success,
}));
import { createGenLayerGovernance } from "../../src/integrations/genlayer";

const raw = "0x010203" as const;
const reference = keccak256(raw);
const mandateHash = "0x" + "a".repeat(64);
const policy: Policy = {
  treasuryId: "0x" + "1".repeat(40), agentId: "0x" + "b".repeat(64), version: 1,
  mandate: "Research data services only.", mandateHash,
  perPaymentLimit: "10", weeklyBudget: "40", totalBudget: "200",
  validUntil: 9999999999, recipients: ["0x" + "2".repeat(40)],
};
const payment: Payment = {
  id: "0x" + "c".repeat(64), treasuryId: policy.treasuryId, agentId: policy.agentId,
  policyVersion: 1, mandateHash, recipient: policy.recipients[0], amount: "1",
  amountUnits: "1000000", requestHash: mandateHash,
  service: "Research API", purpose: "Acquire research data", evidence: "Dataset invoice",
  idempotencyKey: "journal-request-1", createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(), status: "awaiting_finality", attempts: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.clients.length = 0;
  vi.stubEnv("GENLAYER_CONTRACT_ADDRESS", "0x" + "3".repeat(40));
  vi.stubEnv("GENLAYER_OPERATOR_PRIVATE_KEY", "0x" + "7".repeat(64));
  vi.stubEnv("GENLAYER_NETWORK", "studio-dev");
  mock.estimateTransactionFees.mockResolvedValue({ distribution: {}, feeValue: 0n });
  mock.signTransaction.mockResolvedValue(raw);
  mock.sendRawTransaction.mockResolvedValue(reference);
  mock.success.mockReturnValue(true);
  mock.writeContract.mockImplementation(async (configuration) => {
    const signed = await configuration.account.signTransaction({ chainId: 61997 });
    return mock.sendRawTransaction({ serializedTransaction: signed });
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("durable Studio governance signing journal", () => {
  it("awaits durable preparation before allowing any broadcast", async () => {
    const sequence: string[] = [];
    mock.sendRawTransaction.mockImplementation(async () => { sequence.push("broadcast"); return reference; });
    const onPrepared = vi.fn(async (signed) => {
      expect(signed).toEqual({ reference, rawTransaction: raw });
      sequence.push("persist");
      await Promise.resolve();
    });
    expect(await createGenLayerGovernance().submit(policy, payment, { onPrepared })).toBe(reference);
    expect(sequence).toEqual(["persist", "broadcast"]);
    expect(onPrepared).toHaveBeenCalledOnce();
  });

  it("cannot broadcast when durable preparation fails", async () => {
    await expect(createGenLayerGovernance().submit(policy, payment, {
      onPrepared: async () => { throw new Error("Lease lost before persistence"); },
    })).rejects.toThrow("Lease lost");
    expect(mock.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("preserves the signed reference even when the broadcast response is lost", async () => {
    const onPrepared = vi.fn(async () => {});
    mock.sendRawTransaction.mockRejectedValue(new Error("RPC response lost"));
    await expect(createGenLayerGovernance().submit(policy, payment, { onPrepared })).rejects.toThrow("RPC response lost");
    expect(onPrepared).toHaveBeenCalledExactlyOnceWith({ reference, rawTransaction: raw });
    expect(mock.signTransaction).toHaveBeenCalledOnce();
  });

  it("rejects an RPC acknowledgement that differs from the persisted envelope hash", async () => {
    const onPrepared = vi.fn(async () => {});
    mock.sendRawTransaction.mockResolvedValue("0x" + "8".repeat(64));
    await expect(createGenLayerGovernance().submit(policy, payment, { onPrepared })).rejects.toMatchObject({ code: "GOVERNANCE_REFERENCE_MISMATCH" });
    expect(onPrepared).toHaveBeenCalledExactlyOnceWith({ reference, rawTransaction: raw });
  });

  it("journals policy registration before broadcast", async () => {
    mock.readContract.mockResolvedValue("");
    mock.waitForTransactionReceipt.mockResolvedValue({ statusName: "FINALIZED" });
    const onPrepared = vi.fn(async () => {});
    await createGenLayerGovernance().register(policy, { onPrepared });
    expect(onPrepared).toHaveBeenCalledExactlyOnceWith({ reference, rawTransaction: raw });
    expect(mock.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({ hash: reference, waitUntil: "finalized" }));
  });

  it("recovers a prepared policy registration using its exact bytes without signing again", async () => {
    mock.readContract.mockResolvedValue("");
    mock.waitForTransactionReceipt.mockResolvedValue({ statusName: "FINALIZED" });
    await createGenLayerGovernance().register(policy, { prepared: { reference, rawTransaction: raw } });
    expect(mock.sendRawTransaction).toHaveBeenCalledExactlyOnceWith({ serializedTransaction: raw });
    expect(mock.writeContract).not.toHaveBeenCalled();
    expect(mock.signTransaction).not.toHaveBeenCalled();
  });

  it("does not release a saved registration gate solely because an older matching policy is visible", async () => {
    mock.readContract.mockResolvedValue(JSON.stringify({ mandate_hash: policy.mandateHash, text: policy.mandate }));
    mock.getTransaction.mockResolvedValue({ statusName: "ACCEPTED" });
    mock.waitForTransactionReceipt.mockRejectedValue(new Error("Saved registration not finalized yet"));
    await expect(createGenLayerGovernance().register(policy, { prepared: { reference, rawTransaction: raw } })).rejects.toThrow("not finalized yet");
    expect(mock.sendRawTransaction).not.toHaveBeenCalled();
    expect(mock.signTransaction).not.toHaveBeenCalled();
  });

  it("fails a finalized saved registration error even when a matching policy is already visible", async () => {
    mock.readContract.mockResolvedValue(JSON.stringify({ mandate_hash: policy.mandateHash, text: policy.mandate }));
    mock.getTransaction.mockResolvedValue({ statusName: "FINALIZED" });
    mock.waitForTransactionReceipt.mockResolvedValue({ statusName: "FINALIZED" });
    mock.success.mockReturnValue(false);
    await expect(createGenLayerGovernance().register(policy, { prepared: { reference, rawTransaction: raw } })).rejects.toMatchObject({ code: "POLICY_REGISTRATION_FAILED" });
    expect(mock.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rebroadcasts a missing transaction with the exact journaled bytes and returns pending", async () => {
    mock.getTransaction.mockRejectedValue(Object.assign(new Error("Transaction not found"), { name: "TransactionNotFoundError" }));
    const decision = await createGenLayerGovernance().inspect(reference, { ...payment, rawGovernanceTransaction: raw });
    expect(decision).toMatchObject({ finalized: false, status: "pending", requestHash: payment.requestHash });
    expect(mock.sendRawTransaction).toHaveBeenCalledExactlyOnceWith({ serializedTransaction: raw });
    expect(mock.signTransaction).not.toHaveBeenCalled();
  });

  it("does not rebroadcast on unrelated RPC failures", async () => {
    mock.getTransaction.mockRejectedValue(new Error("RPC service unavailable"));
    await expect(createGenLayerGovernance().inspect(reference, { ...payment, rawGovernanceTransaction: raw })).rejects.toThrow("RPC service unavailable");
    expect(mock.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects journal bytes that do not match the saved reference", async () => {
    mock.getTransaction.mockRejectedValue(Object.assign(new Error("Transaction not found"), { name: "TransactionNotFoundError" }));
    await expect(createGenLayerGovernance().inspect(reference, { ...payment, rawGovernanceTransaction: "0x010204" })).rejects.toMatchObject({ code: "INVALID_GOVERNANCE_JOURNAL" });
    expect(mock.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("does not assume an EVM hash is a consensus ID on non-Studio networks", async () => {
    vi.stubEnv("GENLAYER_NETWORK", "bradbury");
    await expect(createGenLayerGovernance().submit(policy, payment, { onPrepared: async () => {} })).rejects.toMatchObject({ code: "GOVERNANCE_JOURNAL_UNSUPPORTED" });
    expect(mock.writeContract).not.toHaveBeenCalled();
  });
});
