import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  erc20Abi,
} from "viem";
const client = vi.hoisted(() => ({
  getChainId: vi.fn(),
  readContract: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  sendRawTransaction: vi.fn(),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => client,
}));
import { createAevumSettlement } from "../../src/integrations/aevum";
import { TUSD8_ADDRESS, vaultAbi } from "../../src/integrations/aevum-config";
import type { Treasury, Payment } from "../../src/core/types";
const H = "0x" + "a".repeat(64),
  R = "0x" + "b".repeat(64),
  TX = "0x" + "c".repeat(64);
const owner = "0x" + "1".repeat(40),
  recipient = "0x" + "2".repeat(40),
  vault = "0x" + "3".repeat(40),
  executor = "0x" + "4".repeat(40);
const treasury: Treasury = {
  id: vault,
  owner,
  executor,
  token: TUSD8_ADDRESS,
  agentId: H,
  agentName: "Research",
  balance: "40",
  paused: false,
  active: true,
  policyVersion: 1,
  keyVersion: 1,
  weeklySpent: "4",
  totalSpent: "4",
  week: 5,
};
const payment: Payment = {
  id: R,
  treasuryId: vault,
  agentId: H,
  policyVersion: 1,
  mandateHash: H,
  recipient,
  amount: "4",
  amountUnits: "4000000",
  service: "Research API",
  purpose: "Research",
  evidence: "Invoice",
  idempotencyKey: "request-1",
  requestHash: H,
  decisionRef: TX,
  transactionHash: TX,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  status: "executing",
  attempts: 1,
};
function transfer(from = vault, to = recipient, amount = 4000000n, token: string = TUSD8_ADDRESS) {
  return {
    address: token,
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: from as `0x${string}`, to: to as `0x${string}` },
    }),
    data: encodeAbiParameters(parseAbiParameters("uint256"), [amount]),
  };
}
function receipt(decision = TX) {
  return {
    status: "success",
    logs: [
      {
        address: vault,
        topics: encodeEventTopics({
          abi: vaultAbi,
          eventName: "PaymentExecuted",
          args: {
            requestId: R as `0x${string}`,
            agentId: H as `0x${string}`,
            policyVersion: 1n,
          },
        }),
        data: encodeAbiParameters(
          parseAbiParameters("address,uint256,bytes32,bytes32,uint256"),
          [
            recipient as `0x${string}`,
            4000000n,
            H as `0x${string}`,
            decision as `0x${string}`,
            0n,
          ],
        ),
      },
      transfer(),
    ],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AEVUM_EXECUTOR_PRIVATE_KEY", undefined);
  client.getChainId.mockResolvedValue(44005);
  client.readContract.mockImplementation(
    async ({ functionName }) =>
      ({
        owner,
        executor,
        token: TUSD8_ADDRESS,
        paused: false,
        agentConfig: [
          1n,
          H,
          10000000n,
          40000000n,
          200000000n,
          9999999999n,
          true,
        ],
        isAgentActive: true,
        spentBudgets: [5n, 4000000n, 4000000n],
        balanceOf: 40000000n,
        decimals: 6,
        isRecipientAllowed: true,
        executed: false,
      })[functionName as string],
  );
});
afterEach(() => vi.unstubAllEnvs());
describe("Aevum settlement isolation and receipts", () => {
  it("requires official chain identity", async () => {
    client.getChainId.mockResolvedValue(44001);
    await expect(createAevumSettlement().snapshot(treasury)).rejects.toThrow(
      "not Aevum",
    );
  });
  it("reads exact token units and authoritative week", async () => {
    const snapshot = await createAevumSettlement().snapshot(treasury, [
      recipient,
    ]);
    expect(snapshot).toMatchObject({
      balance: "40",
      weeklySpent: "4",
      week: 5,
      recipients: [recipient],
      policyVersion: 1,
    });
  });
  it("rejects a different settlement token", async () => {
    const old = client.readContract.getMockImplementation()!;
    client.readContract.mockImplementation(async (args) =>
      args.functionName === "token" ? recipient : old(args),
    );
    await expect(createAevumSettlement().snapshot(treasury)).rejects.toThrow(
      "not Aevum tUSD8",
    );
  });
  it("rejects incompatible token precision", async () => {
    const old = client.readContract.getMockImplementation()!;
    client.readContract.mockImplementation(async (args) =>
      args.functionName === "decimals" ? 18 : old(args),
    );
    await expect(createAevumSettlement().snapshot(treasury)).rejects.toThrow(
      "decimals",
    );
  });
  it("filters recipients using contract authority", async () => {
    const old = client.readContract.getMockImplementation()!;
    client.readContract.mockImplementation(async (args) =>
      args.functionName === "isRecipientAllowed" ? false : old(args),
    );
    expect(
      (await createAevumSettlement().snapshot(treasury, [recipient]))
        .recipients,
    ).toEqual([]);
  });
  it("refuses payout signing without worker key", async () => {
    await expect(
      createAevumSettlement().prepare(treasury, payment),
    ).rejects.toThrow("worker");
  });
  it("verifies complete emitted payment linkage", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt());
    expect(await createAevumSettlement().reconcile(payment)).toEqual({
      status: "settled",
      transactionHash: TX,
    });
  });
  it("does not settle an ABI-compatible vault event without a real official-token transfer", async () => {
    const valid = receipt();
    client.getTransactionReceipt.mockResolvedValue({ ...valid, logs: [valid.logs[0]] });
    expect(await createAevumSettlement().reconcile(payment)).toMatchObject({
      status: "verification_failed",
      transactionHash: TX,
    });
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });
  it.each([
    ["different token emitter", () => [transfer(vault, recipient, 4000000n, owner)]],
    ["different source", () => [transfer(owner)]],
    ["different recipient", () => [transfer(vault, owner)]],
    ["different amount", () => [transfer(vault, recipient, 3999999n)]],
    ["duplicate outgoing transfer", () => [transfer(), transfer()]],
    ["conflicting extra outgoing transfer", () => [transfer(), transfer(vault, owner, 1n)]],
  ] as const)("rejects token proof with %s", async (_label, transfers) => {
    const valid = receipt();
    client.getTransactionReceipt.mockResolvedValue({ ...valid, logs: [valid.logs[0], ...transfers()] });
    expect(await createAevumSettlement().reconcile(payment)).toMatchObject({
      status: "verification_failed", transactionHash: TX,
    });
    expect(client.getTransaction).not.toHaveBeenCalled();
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("reports a mined token transfer with no vault receipt without claiming a revert or retrying it", async () => {
    client.getTransactionReceipt.mockResolvedValue({ status: "success", logs: [transfer()] });
    const outcome = await createAevumSettlement().reconcile(payment);
    expect(outcome).toMatchObject({ status: "verification_failed", transactionHash: TX });
    expect(outcome.reason).toContain("Token movement may have occurred");
    expect(client.getTransaction).not.toHaveBeenCalled();
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("rejects duplicated or conflicting vault payment records even with a real token transfer", async () => {
    const valid = receipt();
    client.getTransactionReceipt.mockResolvedValue({ ...valid, logs: [...valid.logs, receipt(H).logs[0]] });
    expect((await createAevumSettlement().reconcile(payment)).status).toBe("verification_failed");
  });
  it.each([
    ["id", H], ["requestHash", R], ["agentId", R],
    ["policyVersion", 2], ["recipient", owner], ["amountUnits", "4000001"],
  ] as const)("requires the recorded %s to match the vault event", async (field, value) => {
    client.getTransactionReceipt.mockResolvedValue(receipt());
    expect((await createAevumSettlement().reconcile({ ...payment, [field]: value })).status)
      .toBe("verification_failed");
  });
  it("requires the payment record emitter to be this vault", async () => {
    const valid = receipt();
    client.getTransactionReceipt.mockResolvedValue({ ...valid, logs: [{ ...valid.logs[0], address: owner }, valid.logs[1]] });
    expect((await createAevumSettlement().reconcile(payment)).status).toBe("verification_failed");
  });
  it("allows unrelated token transfers without confusing them with this vault's unique outgoing payment", async () => {
    const valid = receipt();
    client.getTransactionReceipt.mockResolvedValue({ ...valid, logs: [...valid.logs, transfer(owner, recipient, 1n)] });
    expect((await createAevumSettlement().reconcile(payment)).status).toBe("settled");
  });
  it("rejects receipt with another decision reference", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt(H));
    expect(await createAevumSettlement().reconcile(payment)).toMatchObject({
      status: "verification_failed", transactionHash: TX,
    });
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("reports reverted transactions without claiming payment", async () => {
    client.getTransactionReceipt.mockResolvedValue({ status: "reverted" });
    expect((await createAevumSettlement().reconcile(payment)).status).toBe(
      "failed",
    );
  });
  it("keeps pending transactions pending", async () => {
    const absent = new Error("not found");
    absent.name = "TransactionReceiptNotFoundError";
    client.getTransactionReceipt.mockRejectedValue(absent);
    client.getTransaction.mockResolvedValue({ hash: TX });
    expect((await createAevumSettlement().reconcile(payment)).status).toBe(
      "pending",
    );
  });
  it("distinguishes RPC outage from missing transaction", async () => {
    client.getTransactionReceipt.mockRejectedValue(
      new Error("RPC unavailable"),
    );
    await expect(createAevumSettlement().reconcile(payment)).rejects.toThrow(
      "RPC unavailable",
    );
  });
  it("fails closed for onchain executed ID with missing history hash", async () => {
    const old = client.readContract.getMockImplementation()!;
    client.readContract.mockImplementation(async (args) =>
      args.functionName === "executed" ? true : old(args),
    );
    await expect(
      createAevumSettlement().reconcile({
        ...payment,
        transactionHash: undefined,
      }),
    ).rejects.toThrow("reconciliation");
  });
});
