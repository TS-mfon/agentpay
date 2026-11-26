import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";
import { policySchema } from "../../src/core/validation";
import type { DashboardData } from "../../src/components/types";

const external = vi.hoisted(() => ({ requestAddresses: vi.fn(), getChainId: vi.fn(), writeContract: vi.fn(), readContract: vi.fn(), waitForTransactionReceipt: vi.fn(), api: vi.fn() }));
vi.mock("viem", async (original) => ({
  ...await original<typeof import("viem")>(),
  createWalletClient: () => external,
  createPublicClient: () => external,
}));
vi.mock("../../src/components/api", () => ({ api: external.api }));
import { configurePolicy, prepareTreasury } from "../../src/components/wallet";

const owner = "0x1111111111111111111111111111111111111111";
const vault = "0x3333333333333333333333333333333333333333";
const agentId = "0x" + "4".repeat(64);
const settlementAsset = "0x456569838f1d43009A91ebA4263147Afd7233483";
const txHash = "0x" + "5".repeat(64);
const policy = { mandate: "\n  Research services only\nProvider evidence required. \r\n", perPaymentLimit: "10", weeklyBudget: "40", totalBudget: "200", validUntil: 2000000000, recipients: ["0x2222222222222222222222222222222222222222"] };
const data: DashboardData = {
  mode: "live", owner,
  treasury: { id: vault, agentId, agentName: "Research", owner, executor: owner, token: settlementAsset, balance: "40", paused: false, active: true, policyVersion: 1, keyVersion: 1, weeklySpent: "0", totalSpent: "0" },
  policy: { ...policy, version: 1, mandateHash: "0x" + "6".repeat(64) }, payments: [], services: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("window", { ethereum: { request: vi.fn() } });
  external.requestAddresses.mockResolvedValue([owner]);
  external.getChainId.mockResolvedValue(44005);
  external.writeContract.mockResolvedValue(txHash);
  external.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  external.readContract.mockResolvedValue([1n]);
});
afterEach(() => vi.unstubAllGlobals());

describe("owner mandate wallet consistency", () => {
  it("does not sign when the current on-chain version cannot be read", async () => {
    external.readContract.mockRejectedValue(new Error("Aevum RPC unavailable"));
    await expect(configurePolicy(data, policy)).rejects.toThrow("Aevum RPC unavailable");
    expect(external.writeContract).not.toHaveBeenCalled();
  });
  it("preserves owner isolation before looking up or signing a policy", async () => {
    external.requestAddresses.mockResolvedValue(["0x7777777777777777777777777777777777777777"]);
    await expect(configurePolicy(data, policy)).rejects.toThrow("Connect the treasury owner's wallet.");
    expect(external.readContract).not.toHaveBeenCalled();
    expect(external.writeContract).not.toHaveBeenCalled();
  });
  it("does not choose a version below the registered policy when an RPC read lags", async () => {
    external.readContract.mockResolvedValue([2n]);
    await configurePolicy({ ...data, policy: { ...data.policy, version: 4 } }, policy);
    expect(external.writeContract.mock.calls[0][0].args[1]).toBe(5n);
  });
  it("normalizes direct onboarding input before configuring the first spending mandate", async () => {
    external.api.mockResolvedValue({ mode: "live", token: settlementAsset, executor: owner });
    external.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "owner") return owner;
      if (functionName === "token") return settlementAsset;
      return [2n];
    });
    await expect(prepareTreasury({ ...policy, treasuryId: vault, agentName: "Research" }, owner, false, vi.fn())).resolves.toBe(vault);
    const submitted = external.writeContract.mock.calls[0][0];
    expect(submitted.args[2]).toBe(keccak256(toBytes(policySchema.parse(policy).mandate)));
    expect(submitted.args[1]).toBe(3n);
  });
  it("stops treasury deployment when the selected wallet differs from the signed-in owner", async () => {
    external.requestAddresses.mockResolvedValue([vault]);
    await expect(prepareTreasury({ ...policy, treasuryId: "", agentName: "Research" }, owner, true, vi.fn()))
      .rejects.toThrow("Connect the wallet you used to sign in.");
    expect(external.api).not.toHaveBeenCalled();
  });
  it("uses a fresh on-chain version after an owner transaction succeeded but API registration did not", async () => {
    external.readContract.mockResolvedValue([2n]);
    await configurePolicy(data, policy);
    expect(external.writeContract.mock.calls[0][0].args[1]).toBe(3n);
    expect(external.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: vault, functionName: "agentConfig", args: [agentId], blockTag: "latest",
    }));
  });
  it("hashes the exact server-normalized mandate when copied text contains trailing whitespace", async () => {
    await expect(configurePolicy(data, policy)).resolves.toBe(txHash);
    const submitted = external.writeContract.mock.calls[0][0];
    expect(submitted.args[2]).toBe(keccak256(toBytes(policySchema.parse(policy).mandate)));
    expect(submitted.args.slice(3)).toEqual([10000000n, 40000000n, 200000000n, 2000000000n, policy.recipients]);
    expect(policy.mandate).toBe("\n  Research services only\nProvider evidence required. \r\n");
  });
});
