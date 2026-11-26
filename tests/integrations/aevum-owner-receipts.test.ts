import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters, encodeEventTopics, erc20Abi, parseAbiParameters,
  keccak256, parseEventLogs, stringToHex, toHex, zeroAddress, type Address, type Hex, type Log,
} from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import type { OwnerIntent, OwnerOperationRecord } from "../../src/core/owner-operations";
import { TUSD8_ADDRESS, vaultAbi } from "../../src/integrations/aevum-config";
import { createOwnerOperationChain } from "../../src/integrations/aevum-owner-receipts";
import {
  ownerNonceKey, qdayBundlerClient, qdayPublicClient, qdaySmartAccount,
} from "../../src/integrations/qday-smart-account";

const owner = "0x1111111111111111111111111111111111111111";
const treasuryId = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const agentId = `0x${"a".repeat(64)}` as const;
const operationHash = `0x${"b".repeat(64)}` as const;
const otherOperationHash = `0x${"c".repeat(64)}` as const;
const transactionHash = `0x${"d".repeat(64)}` as const;
const blockHash = `0x${"e".repeat(64)}` as const;
const nonce = (ownerNonceKey << 64n) + 2n;
const blockNumber = 60n;
const amount = 1_250_000n;
const operation: NonNullable<OwnerOperationRecord["operation"]> = {
  sender: owner, nonce: toHex(nonce), callData: "0x01", signature: "0x02",
  callGasLimit: "0x1000", verificationGasLimit: "0x1100", preVerificationGas: "0x1200",
  maxFeePerGas: "0x10", maxPriorityFeePerGas: "0x01",
};
const record: OwnerOperationRecord = {
  hash: operationHash, owner, operation, status: "pending", nextBlock: "50",
  intent: { action: "fund", treasuryId, agentId, amount: "1.25" },
};
const resume: OwnerIntent = {
  action: "resume", treasuryId, agentId, version: 4,
  policy: { mandate: "Purchase datasets for approved research.", perPaymentLimit: "1.25",
    weeklyBudget: "3", totalBudget: "7", validUntil: 2_000_000_000, recipients: [recipient] },
};

type ReceiptLog = Pick<Log, "address" | "data" | "topics">;

function beforeExecution(): ReceiptLog {
  return {
    address: qdaySmartAccount.entryPoint, data: "0x",
    topics: encodeEventTopics({ abi: entryPoint07Abi, eventName: "BeforeExecution" }) as Log["topics"],
  };
}

function operationEvent(hash: Hex = operationHash, success = true,
  sender: Address = owner, operationNonce = nonce, paymaster: Address = zeroAddress): ReceiptLog {
  return {
    address: qdaySmartAccount.entryPoint,
    topics: encodeEventTopics({ abi: entryPoint07Abi, eventName: "UserOperationEvent",
      args: { userOpHash: hash, sender, paymaster } }) as Log["topics"],
    data: encodeAbiParameters(parseAbiParameters("uint256, bool, uint256, uint256"),
      [operationNonce, success, 5n, 7n]),
  };
}

function transfer(from: Address = owner, to: Address = treasuryId, value = amount): ReceiptLog {
  return {
    address: TUSD8_ADDRESS,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer",
      args: { from, to } }) as Log["topics"],
    data: encodeAbiParameters(parseAbiParameters("uint256"), [value]),
  };
}

function paused(value: boolean, epoch = 4n): ReceiptLog {
  return {
    address: treasuryId,
    topics: encodeEventTopics({ abi: vaultAbi, eventName: "PauseChanged" }) as Log["topics"],
    data: encodeAbiParameters(parseAbiParameters("bool, uint256"), [value, epoch]),
  };
}

function configured(): ReceiptLog {
  return {
    address: treasuryId,
    topics: encodeEventTopics({ abi: vaultAbi, eventName: "AgentConfigured",
      args: { agentId, policyVersion: 4n } }) as Log["topics"],
    data: encodeAbiParameters(parseAbiParameters("bytes32, uint256, uint256, uint256, uint256, uint256, address[]"), [
      keccak256(stringToHex("Purchase datasets for approved research.")), 1_250_000n, 3_000_000n, 7_000_000n,
      2_000_000_000n, 4n, [recipient],
    ]),
  };
}

function withdrawn(to: Address = owner, value = amount): ReceiptLog {
  return {
    address: treasuryId,
    topics: encodeEventTopics({ abi: vaultAbi, eventName: "Withdrawn", args: { recipient: to } }) as Log["topics"],
    data: encodeAbiParameters(parseAbiParameters("uint256"), [value]),
  };
}

function revoked(version = 4n): ReceiptLog {
  return {
    address: treasuryId,
    topics: encodeEventTopics({ abi: vaultAbi, eventName: "AgentRevoked",
      args: { agentId, policyVersion: version } }) as Log["topics"],
    data: "0x",
  };
}

function receipt(...logs: ReceiptLog[]) {
  return {
    status: "success" as const, transactionHash, blockNumber, blockHash,
    logs: logs.map((log, logIndex) => ({ ...log, logIndex, transactionHash,
      blockNumber, blockHash, transactionIndex: 0, removed: false })),
  };
}

function fixture() {
  const client = Object.assign(qdayPublicClient(), {
    getChainId: vi.fn().mockResolvedValue(44005),
    getBlock: vi.fn(async (request: { blockNumber?: bigint }) => ({
      number: request.blockNumber ?? 100n, hash: blockHash,
    })),
    readContract: vi.fn(),
    getTransactionReceipt: vi.fn(),
    getLogs: vi.fn().mockResolvedValue([]),
  });
  const bundler = Object.assign(qdayBundlerClient(client), {
    getUserOperationReceipt: vi.fn().mockResolvedValue({ receipt: { transactionHash } }),
    getSupportedEntryPoints: vi.fn().mockResolvedValue([qdaySmartAccount.entryPoint]),
    request: vi.fn(),
  });
  return { client, bundler, chain: createOwnerOperationChain(client, bundler) };
}

describe("Aevum owner operation receipts", () => {
  it("verifies the exact funding transfer inside its UserOperation in a mixed bundle", async () => {
    const { client, chain } = fixture();
    client.getTransactionReceipt.mockResolvedValue(receipt(
      beforeExecution(), transfer(owner, recipient), operationEvent(otherOperationHash),
      transfer(), operationEvent(), transfer(owner, recipient), operationEvent(otherOperationHash),
    ));

    await expect(chain.inspect(record)).resolves.toEqual({ status: "verified", transactionHash });
    expect(client.getTransactionReceipt).toHaveBeenCalledWith({ hash: transactionHash });
  });

  it("keeps another operation's transfer outside the receipt proof", async () => {
    const { client, chain } = fixture();
    client.getTransactionReceipt.mockResolvedValue(receipt(
      beforeExecution(), transfer(), operationEvent(otherOperationHash), operationEvent(), transfer(),
    ));
    await expect(chain.inspect(record)).resolves.toEqual({ status: "review", transactionHash });
  });

  it("requires exactly one official transfer and a matching withdrawal to the smart account", async () => {
    const { client, chain } = fixture();
    const withdrawal: OwnerOperationRecord = { ...record,
      intent: { ...record.intent, action: "withdraw", amount: "1.25" } };
    client.getTransactionReceipt
      .mockResolvedValueOnce(receipt(beforeExecution(), transfer(treasuryId, owner), withdrawn(), operationEvent()))
      .mockResolvedValueOnce(receipt(beforeExecution(), transfer(treasuryId, owner), withdrawn(recipient), operationEvent()))
      .mockResolvedValueOnce(receipt(beforeExecution(), transfer(treasuryId, owner), transfer(treasuryId, owner), withdrawn(), operationEvent()));
    await expect(chain.inspect(withdrawal)).resolves.toEqual({ status: "verified", transactionHash });
    await expect(chain.inspect(withdrawal)).resolves.toEqual({ status: "review", transactionHash });
    await expect(chain.inspect(withdrawal)).resolves.toEqual({ status: "review", transactionHash });
  });

  it("requires the unpause and exact new configuration in one operation", async () => {
    const { client, chain } = fixture();
    client.getTransactionReceipt
      .mockResolvedValueOnce(receipt(beforeExecution(), paused(false), configured(), operationEvent()))
      .mockResolvedValueOnce(receipt(beforeExecution(), paused(false), operationEvent(otherOperationHash), configured(), operationEvent()))
      .mockResolvedValueOnce(receipt(beforeExecution(), paused(false, 3n), configured(), operationEvent()));
    const resumeRecord = { ...record, intent: resume };
    await expect(chain.inspect(resumeRecord)).resolves.toEqual({ status: "verified", transactionHash });
    await expect(chain.inspect(resumeRecord)).resolves.toEqual({ status: "review", transactionHash });
    await expect(chain.inspect(resumeRecord)).resolves.toEqual({ status: "review", transactionHash });
  });

  it("proves pause and revocation through their own vault events", async () => {
    const { client, chain } = fixture();
    client.getTransactionReceipt
      .mockResolvedValueOnce(receipt(beforeExecution(), paused(true), operationEvent()))
      .mockResolvedValueOnce(receipt(beforeExecution(), paused(true), operationEvent()))
      .mockResolvedValueOnce(receipt(beforeExecution(), revoked(), operationEvent()))
      .mockResolvedValueOnce(receipt(beforeExecution(), revoked(3n), operationEvent()));
    const intent = { treasuryId, agentId, version: 4 };
    const pauseRecord: OwnerOperationRecord = { ...record, intent: { ...intent, action: "pause" } };
    const revokeRecord: OwnerOperationRecord = { ...record, intent: { ...intent, action: "revoke" } };
    await expect(chain.inspect(pauseRecord)).resolves.toEqual({ status: "verified", transactionHash });
    await expect(chain.inspect(revokeRecord)).resolves.toEqual({ status: "review", transactionHash });
    await expect(chain.inspect(revokeRecord)).resolves.toEqual({ status: "verified", transactionHash });
    await expect(chain.inspect(revokeRecord)).resolves.toEqual({ status: "review", transactionHash });
  });

  it("distinguishes a reverted inner operation inside a successful transaction", async () => {
    const { client, chain } = fixture();
    client.getTransactionReceipt.mockResolvedValue(receipt(beforeExecution(), operationEvent(operationHash, false)));
    await expect(chain.inspect(record)).resolves.toEqual({ status: "reverted", transactionHash });
  });

  it("requires the canonical EntryPoint event to bind sender, nonce and no paymaster", async () => {
    const { client, chain } = fixture();
    client.getTransactionReceipt
      .mockResolvedValueOnce(receipt(beforeExecution(), transfer(), operationEvent(operationHash, true, recipient)))
      .mockResolvedValueOnce(receipt(beforeExecution(), transfer(), operationEvent(operationHash, true, owner, nonce + 1n)))
      .mockResolvedValueOnce(receipt(beforeExecution(), transfer(), operationEvent(operationHash, true, owner, nonce, recipient)));
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(chain.inspect(record)).resolves.toEqual({ status: "review", transactionHash });
    }
  });

  it("recovers an included operation from Aevum when the bundler has no receipt", async () => {
    const { client, bundler, chain } = fixture();
    bundler.getUserOperationReceipt.mockRejectedValue(new Error("No bundler receipt"));
    const mined = receipt(beforeExecution(), transfer(), operationEvent());
    client.getLogs.mockResolvedValue([mined.logs[2]]);
    client.getTransactionReceipt.mockResolvedValue(mined);

    await expect(chain.inspect(record)).resolves.toEqual({ status: "verified", transactionHash });
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ address: qdaySmartAccount.entryPoint,
      args: { userOpHash: operationHash }, fromBlock: 50n, toBlock: 99n }));
  });

  it("advances one bounded range at a time and waits for a confirmed nonce", async () => {
    const { client, bundler, chain } = fixture();
    bundler.getUserOperationReceipt.mockResolvedValue(null);
    client.getBlock.mockImplementation(async request => ({ number: request.blockNumber ?? 1300n, hash: blockHash }));
    client.readContract.mockResolvedValue(nonce);

    await expect(chain.inspect(record)).resolves.toEqual({ status: "pending", nextBlock: 1050n });
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 50n, toBlock: 1049n }));
    expect(client.readContract).toHaveBeenLastCalledWith(expect.objectContaining({
      functionName: "getNonce", blockNumber: 1049n,
    }));

    await expect(chain.inspect({ ...record, nextBlock: "1050" })).resolves.toEqual({ status: "pending", nextBlock: 1299n });
    expect(client.readContract).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: "getNonce",
      args: [owner, ownerNonceKey], blockNumber: 1299n }));

    client.readContract.mockResolvedValue(nonce + 1n);
    const replacement = { ...receipt(beforeExecution(), operationEvent(otherOperationHash)), blockNumber: 1299n };
    client.getLogs.mockResolvedValueOnce([]).mockResolvedValueOnce(parseEventLogs({
      abi: entryPoint07Abi, eventName: "UserOperationEvent", logs: replacement.logs,
    }));
    client.getTransactionReceipt.mockResolvedValue(replacement);
    await expect(chain.inspect({ ...record, nextBlock: "1299" })).resolves.toEqual({ status: "replaced" });
  });

  it("keeps the old cursor if the scan's chain head changes", async () => {
    const { client, bundler, chain } = fixture();
    bundler.getUserOperationReceipt.mockResolvedValue(null);
    client.readContract.mockResolvedValue(nonce + 1n);
    client.getBlock.mockResolvedValueOnce({ number: 100n, hash: blockHash })
      .mockResolvedValue({ number: 100n, hash: operationHash });

    await expect(chain.inspect(record)).resolves.toEqual({ status: "pending", nextBlock: 50n });
  });

  it("keeps a newly mined operation pending until its block has a successor", async () => {
    const { client, chain } = fixture();
    client.getTransactionReceipt.mockResolvedValue(receipt(beforeExecution(), transfer(), operationEvent()));
    client.getBlock.mockImplementation(async request => ({ number: request.blockNumber ?? blockNumber, hash: blockHash }));
    client.readContract.mockResolvedValue(nonce);

    await expect(chain.inspect(record)).resolves.toEqual({ status: "pending", nextBlock: 59n });
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 59n }));
  });

  it("recovers the recorded operation if event indexing catches up after the nonce is first seen spent", async () => {
    const { client, bundler, chain } = fixture();
    bundler.getUserOperationReceipt.mockResolvedValue(null);
    const mined = receipt(beforeExecution(), transfer(), operationEvent());
    client.getLogs.mockResolvedValueOnce([]).mockResolvedValueOnce(parseEventLogs({
      abi: entryPoint07Abi, eventName: "UserOperationEvent", logs: mined.logs,
    }));
    client.readContract.mockResolvedValue(nonce + 1n);
    client.getTransactionReceipt.mockResolvedValue(mined);

    await expect(chain.inspect(record)).resolves.toEqual({ status: "verified", transactionHash });
  });

  it("keeps its cursor when nonce consumption is visible before any operation event", async () => {
    const { client, bundler, chain } = fixture();
    bundler.getUserOperationReceipt.mockResolvedValue(null);
    client.readContract.mockResolvedValue(nonce + 1n);
    client.getBlock.mockImplementation(async request => ({ number: request.blockNumber ?? 1300n, hash: blockHash }));

    await expect(chain.inspect(record)).resolves.toEqual({ status: "pending", nextBlock: 50n });
  });

  it("pins the owner, token, version and operation nonce to one Aevum block", async () => {
    const { client, chain } = fixture();
    const values: Record<string, unknown> = {
      owner, token: TUSD8_ADDRESS, getNonce: nonce, agentConfig: [3n],
    };
    client.readContract.mockImplementation(async ({ functionName }) => values[functionName]);

    await expect(chain.check(owner, resume, nonce)).resolves.toBe(100n);
    expect(client.readContract.mock.calls).toHaveLength(4);
    expect(client.readContract.mock.calls.every(([call]) => call.blockNumber === 100n)).toBe(true);
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "getNonce",
      address: qdaySmartAccount.entryPoint, args: [owner, ownerNonceKey] }));
    await expect(chain.check(owner, resume, nonce - 1n)).rejects.toMatchObject({ code: "OWNER_OPERATION_STALE" });
    await expect(chain.check(owner, { ...resume, version: 3 }, nonce)).rejects.toMatchObject({ code: "OWNER_OPERATION_STALE" });
    await expect(chain.check(recipient, resume, nonce)).rejects.toMatchObject({ code: "VAULT_MISMATCH" });
  });

  it("rejects the wrong testnet or token before accepting a vault", async () => {
    const { client, chain } = fixture();
    client.getChainId.mockResolvedValueOnce(1);
    await expect(chain.check(owner, record.intent, nonce)).rejects.toThrow(/QDay Aevum Testnet/);
    expect(client.readContract).not.toHaveBeenCalled();

    const values: Record<string, unknown> = { owner, token: recipient, getNonce: nonce };
    client.readContract.mockImplementation(async ({ functionName }) => values[functionName]);
    await expect(chain.check(owner, record.intent, nonce)).rejects.toMatchObject({ code: "VAULT_MISMATCH" });
    expect(client.readContract.mock.calls.some(([call]) => call.functionName === "agentConfig")).toBe(false);
  });

  it("sends the original signed wire envelope only to a verified Aevum bundler", async () => {
    const { chain, bundler } = fixture();
    bundler.request.mockResolvedValueOnce("0xabe5").mockResolvedValueOnce(operationHash).mockResolvedValueOnce("0x1");
    await expect(chain.broadcast(operation)).resolves.toBe(operationHash);
    expect(bundler.request).toHaveBeenCalledWith({ method: "eth_sendUserOperation",
      params: [operation, qdaySmartAccount.entryPoint] }, { retryCount: 0 });
    await expect(chain.broadcast(operation)).rejects.toThrow(/Aevum/);
    expect(bundler.request).toHaveBeenCalledTimes(3);
  });
});
