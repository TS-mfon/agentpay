import {
  BaseError, ContractFunctionRevertedError, concatHex, createPublicClient, encodeFunctionData, hashMessage,
  http, keccak256, parseAbi, stringToHex, zeroAddress, type Address, type Hex,
} from "viem";
import { createBundlerClient, entryPoint07Address } from "viem/account-abstraction";
import { aevum } from "./aevum-config";

export const qdaySmartAccount = {
  chainId: aevum.id,
  bundlerUrl: "https://bundler.qday.info",
  entryPoint: entryPoint07Address,
  factoryStaker: "0x007Cb4A07296B53eA5e53d043888230797B8FD01",
  factory: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
  implementation: "0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D",
  validator: "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57",
} as const;

export const kernelVersion = "0.3.1";
export const ownerAccountSalt = keccak256(stringToHex("AgentPay Aevum owner v1"));
export const ownerValidatorId = concatHex(["0x01", qdaySmartAccount.validator]);
export const ownerNonceKey = BigInt(qdaySmartAccount.validator) << 16n;
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const kernelAbi = parseAbi([
  "function initialize(bytes21 rootValidator, address hook, bytes validatorData, bytes hookData, bytes[] initConfig)",
  "function entrypoint() view returns (address)",
  "function rootValidator() view returns (bytes21)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
  "function execute(bytes32 mode, bytes executionCalldata) payable",
]);
export const kernelFactoryAbi = parseAbi([
  "function getAddress(bytes data, bytes32 salt) view returns (address)",
  "function implementation() view returns (address)",
]);
const ecdsaValidatorAbi = parseAbi([
  "function ecdsaValidatorStorage(address account) view returns (address)",
]);

export function qdayPublicClient(url?: string) {
  return createPublicClient({ chain: aevum, transport: http(url, { timeout: 10_000, retryCount: 0 }) });
}
export function qdayBundlerClient(client: ReturnType<typeof qdayPublicClient>) {
  return createBundlerClient({ client, chain: aevum,
    transport: http(qdaySmartAccount.bundlerUrl, { timeout: 8_000, retryCount: 0 }) });
}
export async function assertAevum(client: ReturnType<typeof qdayPublicClient>) {
  if (await client.getChainId() !== aevum.id) throw new Error("The RPC is not QDay Aevum Testnet.");
}

export function deriveOwnerAccount(client: ReturnType<typeof qdayPublicClient>, signer: Address, blockNumber?: bigint) {
  return client.readContract({ address: qdaySmartAccount.factory, abi: kernelFactoryAbi,
    functionName: "getAddress", args: [encodeFunctionData({ abi: kernelAbi, functionName: "initialize",
      args: [ownerValidatorId, zeroAddress, signer, "0x", []] }), ownerAccountSalt], blockNumber });
}

export function createSmartOwnerVerifier(client: ReturnType<typeof qdayPublicClient>) {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  async function currentBlock(owner: Address, signer: Address) {
    await assertAevum(client);
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    if (!same(await deriveOwnerAccount(client, signer, blockNumber), owner)) return undefined;
    const slot = await client.getStorageAt({ address: owner, slot: implementationSlot, blockNumber });
    if (!slot || !same(slot, `0x${qdaySmartAccount.implementation.slice(2).padStart(64, "0")}`)) return undefined;
    const [root, entryPoint, currentSigner] = await Promise.all([
      client.readContract({ address: owner, abi: kernelAbi, functionName: "rootValidator", blockNumber }),
      client.readContract({ address: owner, abi: kernelAbi, functionName: "entrypoint", blockNumber }),
      client.readContract({ address: qdaySmartAccount.validator, abi: ecdsaValidatorAbi,
        functionName: "ecdsaValidatorStorage", args: [owner], blockNumber }),
    ]);
    return same(root, ownerValidatorId) && same(entryPoint, qdaySmartAccount.entryPoint) && same(currentSigner, signer)
      ? blockNumber : undefined;
  }

  return {
    async isCurrent(owner: Address, signer: Address) {
      return await currentBlock(owner, signer) !== undefined;
    },
    async verify(owner: Address, signer: Address, message: string, signature: Hex) {
      if (signature.length !== 174 || !signature.toLowerCase().startsWith(ownerValidatorId.toLowerCase())) return false;
      const blockNumber = await currentBlock(owner, signer);
      if (blockNumber === undefined) return false;
      try {
        const result = await client.readContract({ address: owner, abi: kernelAbi,
          functionName: "isValidSignature", args: [hashMessage(message), signature], blockNumber });
        return result === "0x1626ba7e";
      } catch (error) {
        if (error instanceof BaseError && error.walk(cause => cause instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError)
          return false;
        throw error;
      }
    },
  };
}
