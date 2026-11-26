import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import { demoPorts, demoState } from "../../src/server/demo";
import { OwnerOperations, type OwnerOperationChain } from "../../src/server/owner-operations";
import { agentIdFor, encodeOwnerAction, ownerOperationHash } from "../../src/integrations/aevum-owner-actions";
import { ownerNonceKey } from "../../src/integrations/qday-smart-account";

const signer = privateKeyToAccount(generatePrivateKey());
const transactionHash = `0x${"22".repeat(32)}` as const;

function fixture({ registered = true } = {}) {
  const initial = demoState();
  const treasury = initial.treasuries[0];
  const store = new MemoryStore(registered ? initial : { ...initial, treasuries: [], policies: [] });
  const chain = {
    check: vi.fn<OwnerOperationChain["check"]>().mockResolvedValue(555n),
    inspect: vi.fn<OwnerOperationChain["inspect"]>().mockResolvedValue({ status: "pending", nextBlock: 555n }),
    broadcast: vi.fn<OwnerOperationChain["broadcast"]>(),
  };
  const ports = demoPorts();
  const snapshot = vi.fn(async () => {
      const { owner, executor, token, balance, paused, weeklySpent, totalSpent, week } = treasury;
      const { mandateHash, perPaymentLimit, weeklyBudget, totalBudget, validUntil, recipients } = initial.policies[0];
      return { owner, executor, token, balance, paused, weeklySpent, totalSpent, week, mandateHash,
        perPaymentLimit, weeklyBudget, totalBudget, validUntil, recipients, active: false, policyVersion: 1 };
  });
  const service = new AgentPayService(store, { ...ports, settlement: { ...ports.settlement, snapshot } }, "live");
  return { operations: new OwnerOperations(store, service, chain), chain,
    service, store, treasury, snapshot, policy: initial.policies[0], identity: { owner: treasury.owner, signer: signer.address } };
}

describe("QDay owner operation journal", () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });

  async function sign(intent: Parameters<typeof encodeOwnerAction>[0], sequence = 0n) {
    const operation = {
      sender: f.identity.owner as `0x${string}`,
      callData: encodeOwnerAction(intent, f.identity.owner),
      nonce: toHex((ownerNonceKey << 64n) | sequence), callGasLimit: "0xc350", verificationGasLimit: "0x186a0",
      preVerificationGas: "0xc350", maxFeePerGas: "0x7", maxPriorityFeePerGas: "0x1",
      signature: "0x",
    } as const;
    const hash = ownerOperationHash(operation);
    const signature = await signer.signMessage({ message: { raw: hash } });
    return { intent, operation: { ...operation, signature }, hash };
  }

  function signedRevoke() {
    return sign({ action: "revoke", treasuryId: f.treasury.id, agentId: f.treasury.agentId, version: 1 });
  }

  it("recovers a lost broadcast reply and applies a verified revoke only once", async () => {
    const { intent, operation, hash } = await signedRevoke();
    f.chain.broadcast.mockImplementationOnce(async () => {
      expect((await f.store.read()).ownerOperations?.[0]).toMatchObject({ hash, operation });
      throw new Error("Timed out after send");
    });
    expect(await f.operations.submit(f.identity, { intent, operation })).toMatchObject({ status: "pending", userOperationHash: hash });
    f.chain.inspect.mockResolvedValue({ status: "verified", transactionHash });
    const results = await Promise.all([f.operations.resume(f.identity, hash), f.operations.resume(f.identity, hash)]);
    expect(results.every(result => result?.status === "confirmed" && result.transactionHash === transactionHash)).toBe(true);
    expect((await f.store.read()).treasuries[0].keyVersion).toBe(f.treasury.keyVersion + 1);
    expect(await f.operations.submit(f.identity, { intent, operation })).not.toHaveProperty("operation");
    expect(f.chain.broadcast).toHaveBeenCalledTimes(1);
  });

  it("blocks a different signed operation while the account has an unresolved action", async () => {
    const first = await signedRevoke();
    const otherFields = { ...first.operation, maxFeePerGas: "0x8" as const };
    const otherHash = ownerOperationHash(otherFields);
    const signature = await signer.signMessage({ message: { raw: otherHash } });
    f.chain.broadcast.mockResolvedValue(first.hash);
    const results = await Promise.allSettled([
      f.operations.submit(f.identity, first),
      f.operations.submit(f.identity, { intent: first.intent, operation: { ...otherFields, signature } }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "OWNER_OPERATION_PENDING" } });
    expect(f.chain.broadcast).toHaveBeenCalledTimes(1);
  });

  it("rejects other senders, mismatched call data and unsupported paymasters", async () => {
    const { intent, operation } = await signedRevoke();
    for (const envelope of [
      { ...operation, sender: signer.address }, { ...operation, callData: "0x" }, { ...operation, paymaster: signer.address },
    ]) await expect(f.operations.submit(f.identity, { intent, operation: envelope })).rejects.toBeDefined();
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it("records an inner revert without altering the credential", async () => {
    const { intent, operation, hash } = await signedRevoke();
    f.chain.broadcast.mockResolvedValue(hash);
    await f.operations.submit(f.identity, { intent, operation });
    f.chain.inspect.mockResolvedValue({ status: "reverted", transactionHash });
    expect(await f.operations.resume(f.identity, hash)).toMatchObject({ status: "failed", transactionHash });
    expect((await f.store.read()).treasuries[0].keyVersion).toBe(f.treasury.keyVersion);
  });

  it("rebroadcasts the original envelope after a missing receipt", async () => {
    const { intent, operation, hash } = await signedRevoke();
    f.chain.broadcast.mockResolvedValue(hash);
    await f.operations.submit(f.identity, { intent, operation });
    f.chain.inspect.mockResolvedValue({ status: "pending", nextBlock: 556n });
    expect(await f.operations.resume(f.identity, hash, true)).toMatchObject({ status: "pending" });
    expect(f.chain.broadcast.mock.calls).toEqual([[operation], [operation]]);
    expect((await f.store.read()).ownerOperations?.[0].nextBlock).toBe("556");
  });

  it("keeps operation details within the owner session and accepts identical submissions once", async () => {
    const input = await signedRevoke();
    f.chain.broadcast.mockResolvedValue(input.hash);
    await Promise.all([f.operations.submit(f.identity, input), f.operations.submit(f.identity, input)]);
    expect(f.chain.broadcast).toHaveBeenCalledTimes(1);
    expect(await f.operations.get(signer.address, input.hash)).toBeNull();
    expect(await f.operations.resume({ owner: signer.address, signer: f.identity.owner }, input.hash)).toBeNull();
    expect(JSON.stringify(await f.operations.get(f.identity.owner))).not.toContain(input.operation.signature);
  });

  it("registers an owned vault and imports its confirmed atomic-resume policy", async () => {
    f = fixture({ registered: false });
    const { treasuryId, agentId: _demoAgentId, version, mandateHash, ...policy } = f.policy;
    const agentId = agentIdFor(treasuryId, f.treasury.agentName);
    const snapshot = await f.snapshot();
    const setup = await sign({ treasuryId, agentId, version, policy, action: "setup", agentName: f.treasury.agentName });
    f.chain.broadcast.mockResolvedValue(setup.hash);
    f.chain.inspect.mockResolvedValue({ status: "verified", transactionHash });
    f.snapshot.mockResolvedValue({ ...snapshot, paused: true });
    await f.operations.submit(f.identity, setup);
    expect(await f.operations.resume(f.identity, setup.hash)).toMatchObject({ status: "confirmed", action: "setup" });
    expect((await f.service.dashboard(f.identity.owner, treasuryId)).treasury).toMatchObject({ id: treasuryId, paused: true });
    const resume = await sign({ treasuryId, agentId, action: "resume", version: version + 1, policy }, 1n);
    f.chain.broadcast.mockResolvedValue(resume.hash);
    await f.operations.submit(f.identity, resume);
    f.snapshot.mockResolvedValue({ ...snapshot, paused: false, active: true, policyVersion: version + 1 });
    expect(await f.operations.resume(f.identity, resume.hash)).toMatchObject({ status: "confirmed", action: "resume" });
    const dashboard = await f.service.dashboard(f.identity.owner, treasuryId);
    expect(dashboard.policy).toMatchObject({ version: version + 1, mandateHash });
    expect(dashboard.treasury).toMatchObject({ paused: false, active: true });
  });
});
