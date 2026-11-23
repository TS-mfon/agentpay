import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
const mock = vi.hoisted(() => ({
  readContract: vi.fn(),
  writeContract: vi.fn(),
  getTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  success: vi.fn(),
}));
vi.mock("genlayer-js", () => ({
  createClient: () => mock,
  createAccount: () => ({ address: "operator" }),
  isSuccessful: mock.success,
}));
import {
  createGenLayerGovernance,
  policyKey,
} from "../../src/integrations/genlayer";
import type { Policy, Payment } from "../../src/core/types";
const H = "0x" + "a".repeat(64),
  R = "0x" + "b".repeat(64),
  TX = "0x" + "c".repeat(64);
const policy: Policy = {
  treasuryId: "0x" + "1".repeat(40),
  agentId: H,
  version: 1,
  mandate: "Research data services only.",
  mandateHash: H,
  perPaymentLimit: "10",
  weeklyBudget: "40",
  totalBudget: "200",
  validUntil: 9999999999,
  recipients: ["0x" + "2".repeat(40)],
};
const payment: Payment = {
  id: R,
  treasuryId: policy.treasuryId,
  agentId: H,
  policyVersion: 1,
  mandateHash: H,
  recipient: policy.recipients[0],
  amount: "4",
  amountUnits: "4000000",
  service: "Research API",
  purpose: "Acquire market research data",
  evidence: "Invoice describes data",
  idempotencyKey: "request-1",
  requestHash: H,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  status: "awaiting_finality",
  attempts: 1,
};
const record = () => ({
  request_id: R,
  policy_key: policyKey(policy),
  policy_version: 1,
  request_hash: H,
  mandate_hash: H,
  status: "approved",
  reason: "Research API matches the research mandate.",
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GENLAYER_CONTRACT_ADDRESS", "0x" + "3".repeat(40));
  vi.stubEnv("GENLAYER_OPERATOR_PRIVATE_KEY", undefined);
  mock.success.mockReturnValue(true);
});
afterEach(() => vi.unstubAllEnvs());
describe("GenLayer authorization boundary", () => {
  it("rejects missing contract configuration", () => {
    vi.stubEnv("GENLAYER_CONTRACT_ADDRESS", undefined);
    expect(createGenLayerGovernance).toThrow();
  });
  it("does not treat accepted consensus as finalized", async () => {
    mock.getTransaction.mockResolvedValue({ statusName: "ACCEPTED" });
    const decision = await createGenLayerGovernance().inspect(TX, payment);
    expect(decision.finalized).toBe(false);
    expect(mock.readContract).not.toHaveBeenCalled();
  });
  it("fails closed on finalized execution errors", async () => {
    mock.getTransaction.mockResolvedValue({ statusName: "FINALIZED" });
    mock.success.mockReturnValue(false);
    await expect(
      createGenLayerGovernance().inspect(TX, payment),
    ).rejects.toMatchObject({ code: "EVALUATION_FAILED" });
  });
  it("requires matching finalized request/version/mandate", async () => {
    mock.getTransaction.mockResolvedValue({ statusName: "FINALIZED" });
    mock.readContract.mockResolvedValue(JSON.stringify(record()));
    expect(await createGenLayerGovernance().inspect(TX, payment)).toMatchObject(
      { finalized: true, status: "approved", requestHash: H },
    );
    expect(mock.readContract.mock.calls[0][0].transactionHashVariant).toBe(
      "latest-final",
    );
  });
  it.each(["request_id", "policy_key", "request_hash", "mandate_hash"])(
    "rejects mismatched %s",
    async (field) => {
      mock.getTransaction.mockResolvedValue({ statusName: "FINALIZED" });
      mock.readContract.mockResolvedValue(
        JSON.stringify({
          ...record(),
          [field]: field.includes("hash") ? "0x" + "d".repeat(64) : "mismatch",
        }),
      );
      await expect(
        createGenLayerGovernance().inspect(TX, payment),
      ).rejects.toThrow();
    },
  );
  it("returns a missing-record recovery signal instead of approving an absent decision", async () => {
    mock.getTransaction.mockResolvedValue({ statusName: "FINALIZED" });
    mock.readContract.mockResolvedValue("");
    expect(await createGenLayerGovernance().inspect(TX, payment)).toMatchObject({ finalized: true, status: "unavailable", requestHash: payment.requestHash, mandateHash: payment.mandateHash });
  });
  it("fails malformed finalized records as terminal evaluation errors", async () => {
    mock.getTransaction.mockResolvedValue({ statusName: "FINALIZED" });
    mock.readContract.mockResolvedValue('{"status":"approved"}');
    await expect(
      createGenLayerGovernance().inspect(TX, payment),
    ).rejects.toMatchObject({ code: "EVALUATION_MALFORMED" });
  });
  it("preserves needs-information and rejection without approving", async () => {
    mock.getTransaction.mockResolvedValue({ statusName: "FINALIZED" });
    mock.readContract.mockResolvedValue(
      JSON.stringify({ ...record(), status: "needs_information" }),
    );
    expect((await createGenLayerGovernance().inspect(TX, payment)).status).toBe(
      "needs_information",
    );
  });
  it("checks existing immutable mandate text", async () => {
    mock.readContract.mockResolvedValue(
      JSON.stringify({ mandate_hash: H, text: policy.mandate }),
    );
    await createGenLayerGovernance().register(policy);
    expect(mock.writeContract).not.toHaveBeenCalled();
    mock.readContract.mockResolvedValue(
      JSON.stringify({ mandate_hash: H, text: "Changed" }),
    );
    await expect(createGenLayerGovernance().register(policy)).rejects.toThrow(
      "does not match",
    );
  });
  it("does not require worker secrets for read paths but refuses submission", async () => {
    mock.readContract.mockResolvedValue("");
    await expect(createGenLayerGovernance().register(policy)).rejects.toThrow(
      "worker",
    );
    await expect(
      createGenLayerGovernance().submit(policy, payment),
    ).rejects.toThrow("worker");
  });
});
