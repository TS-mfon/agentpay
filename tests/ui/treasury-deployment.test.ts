import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createPublicClient, createWalletClient, custom, encodeAbiParameters, encodeDeployData,
  encodeEventTopics, numberToHex, toFunctionSelector, zeroAddress, type Hex,
} from "viem";
import { clearSmartAccountVaultDeployment, deploySmartAccountVault } from "../../src/components/treasury-deployment";
import { aevum, TUSD8_ADDRESS, vaultAbi } from "../../src/integrations/aevum-config";

const signer = "0x1111111111111111111111111111111111111111" as const;
const owner = "0x2222222222222222222222222222222222222222" as const;
const executor = "0x3333333333333333333333333333333333333333" as const;
const vault = "0x34E0765525c4d4D837Dc20bcb458EdD206120e59" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const blockHash = `0x${"cd".repeat(32)}` as const;
const vaultBytecode = "0x6000" as const;
const initData = encodeDeployData({ abi: vaultAbi, args: [TUSD8_ADDRESS, owner, executor], bytecode: vaultBytecode });

beforeEach(() => {
  const reservations = new Map<string, string>();
  const locked = new Set<string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => reservations.get(key) ?? null,
    setItem: (key: string, value: string) => reservations.set(key, value),
    removeItem: (key: string) => reservations.delete(key),
  });
  vi.stubGlobal("navigator", { locks: {
    async request<T>(name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<T>) {
      if (locked.has(name)) return callback(null);
      locked.add(name);
      try { return await callback({ name, mode: "exclusive" }); }
      finally { locked.delete(name); }
    },
  } });
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  let block = 500;
  let nonce = 7;
  let mined: { input: Hex; status: "0x0" | "0x1" } | undefined;
  const txBlock = 501;
  const topics = encodeEventTopics({ abi: vaultAbi, eventName: "OwnershipTransferred", args: { previousOwner: zeroAddress, newOwner: owner } });
  const log = { address: vault, data: "0x", topics, blockNumber: numberToHex(txBlock), blockHash, transactionHash: hash, transactionIndex: "0x0", logIndex: "0x0", removed: false };
  const addressParams = [{ type: "address" }] as const;
  const currentAddresses = {
    [toFunctionSelector("owner()")]: owner,
    [toFunctionSelector("token()")]: TUSD8_ADDRESS,
    [toFunctionSelector("executor()")]: executor,
  };
  const send = vi.fn(async (_transaction: unknown) => hash);
  const wallet = createWalletClient({ account: signer, chain: aevum, transport: custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "eth_chainId") return numberToHex(aevum.id);
      if (method === "eth_sendTransaction") return send(params?.[0]);
      throw new Error(`Unexpected wallet method ${method}`);
    },
  }, { retryCount: 0 }) });
  const getLogs = vi.fn(({ address, fromBlock, toBlock }: { address: string; fromBlock: Hex; toBlock: Hex }) =>
    mined?.status === "0x1" && address === vault && BigInt(fromBlock) <= txBlock && BigInt(toBlock) >= txBlock ? [log] : []);
  const rpc = createPublicClient({ chain: aevum, transport: custom({
    async request({ method, params }: { method: string; params: [{ data?: Hex }] }) {
      if (method === "eth_chainId") return numberToHex(aevum.id);
      if (method === "eth_blockNumber") return numberToHex(block);
      if (method === "eth_getTransactionCount") return numberToHex(nonce);
      if (method === "eth_getLogs") return getLogs(params[0] as Parameters<typeof getLogs>[0]);
      if (method === "eth_getTransactionByHash") return mined ? {
        hash, from: signer, to: null, input: mined.input, nonce: "0x7", value: "0x0", blockNumber: numberToHex(txBlock), blockHash,
      } : null;
      if (method === "eth_getTransactionReceipt") return mined ? {
        transactionHash: hash, from: signer, to: null, contractAddress: mined.status === "0x1" ? vault : null,
        status: mined.status, blockNumber: numberToHex(txBlock), blockHash, logs: mined.status === "0x1" ? [log] : [],
      } : null;
      if (method === "eth_getCode") return mined?.status === "0x1" ? "0x6001" : "0x";
      const data = params?.[0]?.data;
      if (method === "eth_call" && data && currentAddresses[data]) {
        return encodeAbiParameters(addressParams, [currentAddresses[data]]);
      }
      throw new Error(`Unexpected chain method ${method}`);
    },
  }, { retryCount: 0 }) });
  return {
    send, getLogs, input: { rpc, wallet, signer, owner, vaultBytecode, executor },
    mine({ input = initData, status = "0x1" }: { input?: Hex; status?: "0x0" | "0x1" } = {}) {
      mined = { input, status };
      nonce = 8;
      block = 502;
    },
  };
}

it("recovers a vault whose wallet response was lost without asking to deploy again", async () => {
  const { input, send, mine } = setup();
  send.mockRejectedValueOnce(new Error("Wallet disconnected after submission"));

  await expect(deploySmartAccountVault(input)).rejects.toThrow(/pending/i);
  mine();

  await expect(deploySmartAccountVault(input)).resolves.toBe(vault);
  expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ nonce: "0x7", data: initData }));
});

it("keeps the recovered vault reserved until setup for that exact vault is confirmed", async () => {
  const { input, send, mine } = setup();
  send.mockRejectedValue(new Error("Wallet disconnected"));
  await expect(deploySmartAccountVault(input)).rejects.toThrow(/pending/i);
  mine();
  await expect(deploySmartAccountVault(input)).resolves.toBe(vault);
  await clearSmartAccountVaultDeployment(signer, owner);
  await expect(deploySmartAccountVault(input)).resolves.toBe(vault);
  expect(send).toHaveBeenCalledTimes(1);
  await clearSmartAccountVaultDeployment(signer, vault);
  await expect(deploySmartAccountVault(input)).rejects.toThrow(/pending/i);
  expect(send).toHaveBeenCalledTimes(2);
});

it("keeps a deployment pending when the same nonce has a different creation payload", async () => {
  const { input, send, mine } = setup();
  send.mockRejectedValueOnce(new Error("Wallet disconnected"));
  await expect(deploySmartAccountVault(input)).rejects.toThrow(/pending/i);
  mine({ input: "0x6001" });
  await expect(deploySmartAccountVault(input)).rejects.toThrow(/does not match/);
  expect(send).toHaveBeenCalledTimes(1);
});

it("reuses the exact nonce and creation input when retrying an unseen deployment", async () => {
  const { input, send } = setup();
  send.mockRejectedValue(new Error("Wallet disconnected"));
  await expect(deploySmartAccountVault(input)).rejects.toThrow(/pending/i);
  await expect(deploySmartAccountVault(input)).rejects.toThrow(/pending/i);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
});
