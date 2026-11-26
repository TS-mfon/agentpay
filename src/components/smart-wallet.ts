"use client";

import { createKernelAccount } from "@zerodev/sdk";
import { getEntryPoint } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { BaseError, createWalletClient, custom, encodeFunctionData, erc20Abi,
  formatEther, getAddress, http, isHash, toHex, type Address, type Hex } from "viem";
import { createBundlerClient, formatUserOperationRequest, getUserOperationHash } from "viem/account-abstraction";
import type { OwnerIntent, OwnerMandate, OwnerOperationStatus } from "../core/owner-operations";
import { decimal, parsePolicy, sameAddress, units } from "../core/validation";
import { aevum, TUSD8_ADDRESS, vaultAbi } from "../integrations/aevum-config";
import { agentIdFor, ownerCalls } from "../integrations/aevum-owner-actions";
import { assertAevum, createSmartOwnerVerifier, deriveOwnerAccount, kernelVersion, ownerAccountSalt, qdayBundlerClient,
  qdayPublicClient, qdaySmartAccount } from "../integrations/qday-smart-account";
import { api } from "./api";
import type { DashboardData, OwnerAction } from "./types";
import { browserWalletProvider, connectBrowserWallet, type TreasurySetup } from "./wallet";

const operationsPath = "/api/owner/user-operations";
const rpc = () => qdayPublicClient();
const entryPoint = getEntryPoint("0.7");
const activationCall = (owner: Address) => ({ to: TUSD8_ADDRESS,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }) });
const activationKey = (owner: Address) => `agentpay:smart-account-activation:${aevum.id}:${owner.toLowerCase()}`;

export interface SmartAccountPreview {
  address: Address;
  signer: Address;
  gasBalance: string;
  deployed: boolean;
}

export async function previewSmartAccount(): Promise<SmartAccountPreview> {
  const { account: signer } = await connectBrowserWallet();
  const client = rpc();
  await assertAevum(client);
  const address = getAddress(await deriveOwnerAccount(client, signer));
  const [balance, code] = await Promise.all([client.getBalance({ address }), client.getCode({ address })]);
  return { address, signer, gasBalance: formatEther(balance), deployed: !!code && code !== "0x" };
}

async function browserAccount(expectedOwner: string, expectedSigner?: string) {
  const { account: signer } = await connectBrowserWallet();
  if (expectedSigner && !sameAddress(signer, expectedSigner)) throw new Error("Connect the browser wallet that controls this smart account.");
  const client = rpc();
  await assertAevum(client);
  const address = getAddress(await deriveOwnerAccount(client, signer));
  if (!sameAddress(address, expectedOwner)) throw new Error("Connect the browser wallet that controls this smart account.");
  const wallet = createWalletClient({ account: signer, chain: aevum, transport: custom(browserWalletProvider()) });
  const validator = await signerToEcdsaValidator(client, { signer: wallet, entryPoint, kernelVersion,
    validatorAddress: qdaySmartAccount.validator });
  const account = await createKernelAccount(client, { entryPoint, kernelVersion, plugins: { sudo: validator },
    index: BigInt(ownerAccountSalt), useMetaFactory: true, metaFactoryAddress: qdaySmartAccount.factoryStaker,
    factoryAddress: qdaySmartAccount.factory, accountImplementationAddress: qdaySmartAccount.implementation });
  if (!sameAddress(account.address, address)) throw new Error("QDay’s account factory returned a different address.");
  return { account, client, signer, wallet };
}

type BrowserAccount = Awaited<ReturnType<typeof browserAccount>>;
async function prepareOperation({ account, client }: BrowserAccount, calls: { to: Address; data: Hex }[],
  funding?: { from: Address; amount: bigint }) {
  const bundler = qdayBundlerClient(client);
  const [chainId, entryPoints, gas] = await Promise.all([
    bundler.getChainId(), bundler.getSupportedEntryPoints(), client.getBalance({ address: account.address }),
  ]);
  if (chainId !== aevum.id || !entryPoints.some(point => sameAddress(point, qdaySmartAccount.entryPoint)))
    throw new Error("QDay’s bundler is unavailable for Aevum EntryPoint v0.7.");
  if (gas === 0n) throw new Error("Add tQDAY to the smart account before continuing.");
  if (funding && await client.readContract({ address: TUSD8_ADDRESS, abi: erc20Abi,
    functionName: "balanceOf", args: [funding.from] }) < funding.amount)
    throw new Error("Add tUSD8 to the smart account before funding this treasury.");
  const signedClient = createBundlerClient({ account, client, chain: aevum,
    transport: http(qdaySmartAccount.bundlerUrl, { timeout: 10_000, retryCount: 0 }) });
  let prepared: Awaited<ReturnType<typeof signedClient.prepareUserOperation>>;
  try {
    prepared = await signedClient.prepareUserOperation({ calls });
  } catch (error) {
    if (error instanceof BaseError && /prefund|AA21/.test(error.details || error.message))
      throw new Error("Add more tQDAY to the smart account to cover Aevum gas.");
    throw new Error("QDay could not estimate this operation. Check the smart account’s balances and treasury settings.");
  }
  const maxCost = (prepared.callGasLimit + prepared.verificationGasLimit + prepared.preVerificationGas) * prepared.maxFeePerGas;
  if (gas < maxCost) throw new Error("Add more tQDAY to the smart account to cover Aevum gas.");
  return { ...prepared, signature: await account.signUserOperation(prepared) };
}

async function deployOwnerAccount(connected: BrowserAccount) {
  const { account, client } = connected;
  const key = activationKey(account.address);
  const bundler = qdayBundlerClient(client);
  const saved = localStorage.getItem(key);
  let hash: Hex;
  if (saved) {
    const { reference, envelope } = JSON.parse(saved) as { reference: string; envelope: ReturnType<typeof formatUserOperationRequest> };
    if (!isHash(reference) || !sameAddress(envelope.sender, account.address) || !envelope.factory ||
      !sameAddress(envelope.factory, qdaySmartAccount.factoryStaker) ||
      !sameAddress(envelope.callData, await account.encodeCalls([activationCall(account.address)])))
      throw new Error("The saved smart-account activation could not be recovered.");
    hash = reference;
    await bundler.request({ method: "eth_sendUserOperation", params: [envelope, qdaySmartAccount.entryPoint] }).catch(() => undefined);
  } else {
    const operation = await prepareOperation(connected, [activationCall(account.address)]);
    hash = getUserOperationHash({ userOperation: operation, entryPointVersion: "0.7",
      entryPointAddress: qdaySmartAccount.entryPoint, chainId: aevum.id });
    const envelope = formatUserOperationRequest(operation);
    localStorage.setItem(key, JSON.stringify({ reference: hash, envelope }));
    await bundler.request({ method: "eth_sendUserOperation", params: [envelope, qdaySmartAccount.entryPoint] }).catch(() => undefined);
  }
  await bundler.waitForUserOperationReceipt({ hash, timeout: 25_000, pollingInterval: 2000 }).catch(() => undefined);
  if (!await account.isDeployed())
    throw new Error(`Activation is awaiting confirmation. Retry activation to check UserOperation ${hash}.`);
  localStorage.removeItem(key);
}

export async function activateSmartAccount(preview: SmartAccountPreview) {
  const connected = await browserAccount(preview.address, preview.signer);
  const { client, account, signer } = connected;
  if (!await account.isDeployed()) await deployOwnerAccount(connected);
  else localStorage.removeItem(activationKey(account.address));
  if (!await createSmartOwnerVerifier(client).isCurrent(account.address, signer))
    throw new Error("The deployed smart account does not match this browser wallet.");
  const challenge = await api<{ nonce: string; message: string }>(`/api/auth/nonce?address=${account.address}&signer=${signer}`);
  const signature = await account.signMessage({ message: challenge.message });
  await api("/api/auth/verify", { address: account.address, nonce: challenge.nonce, signature });
}

export function currentOwnerOperation() {
  return api<OwnerOperationStatus | null>(operationsPath);
}

export function resumeOwnerOperation(userOperationHash: Hex, rebroadcast = false) {
  return api<OwnerOperationStatus | null>(operationsPath, { command: "resume", userOperationHash, rebroadcast });
}

export async function submitOwnerAction(connected: BrowserAccount, intent: OwnerIntent) {
  const { account } = connected;
  const pending = await currentOwnerOperation();
  if (pending?.status === "pending") return pending;
  const normalized: OwnerIntent = "policy" in intent ? { ...intent, policy: parsePolicy(intent.policy) } : intent;
  const signed = await prepareOperation(connected, ownerCalls(normalized, account.address), normalized.action === "fund"
    ? { from: account.address, amount: units(normalized.amount) } : undefined);
  if (signed.factory || signed.factoryData) throw new Error("Activate the smart account before managing a treasury.");
  const operation = { sender: account.address, callData: signed.callData, signature: signed.signature,
    nonce: toHex(signed.nonce), callGasLimit: toHex(signed.callGasLimit), verificationGasLimit: toHex(signed.verificationGasLimit),
    preVerificationGas: toHex(signed.preVerificationGas), maxFeePerGas: toHex(signed.maxFeePerGas),
    maxPriorityFeePerGas: toHex(signed.maxPriorityFeePerGas) };
  return api<OwnerOperationStatus>(operationsPath, { command: "submit", intent: normalized, operation });
}

export async function smartWalletControl(data: DashboardData, action: OwnerAction | "policy", policy: OwnerMandate, amount?: string) {
  const connected = await browserAccount(data.owner);
  const treasuryId = data.treasury.id;
  const agentId = data.treasury.agentId as Hex;
  const base = { treasuryId, agentId };
  if (action === "fund" || action === "withdraw") {
    if (!amount || !/^(0|[1-9]\d{0,12})(\.\d{1,6})?$/.test(amount) || units(amount) === 0n)
      throw new Error("Enter a positive tUSD8 amount with up to six decimals.");
    return submitOwnerAction(connected, { ...base, action, amount: decimal(units(amount)) });
  }
  const [current] = await connected.client.readContract({ address: getAddress(treasuryId), abi: vaultAbi,
    functionName: "agentConfig", args: [agentId] });
  if (action === "pause" || action === "revoke")
    return submitOwnerAction(connected, { ...base, action, version: Number(current) });
  return submitOwnerAction(connected, { ...base, action: action === "resume" ? "resume" : "policy", version: Number(current + 1n), policy });
}

export async function smartTreasurySetup(input: TreasurySetup, owner: string, createNew: boolean,
  progress: (message: string) => void, onVaultCreated: (address: string) => void) {
  const pending = await currentOwnerOperation();
  if (pending?.status === "pending") return pending;
  const connected = await browserAccount(owner);
  const { client, signer, wallet } = connected;
  let treasuryId = input.treasuryId;
  if (createNew) {
    const config = await api<{ executor: Address | null; vaultBytecode?: Hex }>("/api/config");
    if (!config.executor || !config.vaultBytecode) throw new Error("Treasury deployment is unavailable.");
    progress("Confirm vault deployment in your browser wallet…");
    const { deploySmartAccountVault } = await import("./treasury-deployment");
    treasuryId = await deploySmartAccountVault({ rpc: client, wallet, signer, owner: getAddress(owner),
      vaultBytecode: config.vaultBytecode, executor: config.executor });
    onVaultCreated(treasuryId);
    const { agents } = await api<{ agents: { id: string }[] }>("/api/owner/agents");
    if (agents.some(agent => sameAddress(agent.id, treasuryId))) {
      const { clearSmartAccountVaultDeployment } = await import("./treasury-deployment");
      await clearSmartAccountVaultDeployment(signer, getAddress(treasuryId));
      throw new Error("That deployment is already registered. Open it from My agents, or start a new treasury.");
    }
  }
  const address = getAddress(treasuryId);
  const [vaultOwner, token] = await Promise.all([
    client.readContract({ address, abi: vaultAbi, functionName: "owner" }),
    client.readContract({ address, abi: vaultAbi, functionName: "token" }),
  ]);
  if (!sameAddress(vaultOwner, owner) || !sameAddress(token, TUSD8_ADDRESS))
    throw new Error("The vault must belong to this smart account and use Aevum tUSD8.");
  const { treasuryId: _treasuryId, agentName, ...policy } = input;
  const agentId = agentIdFor(treasuryId, agentName);
  const [current] = await client.readContract({ address, abi: vaultAbi, functionName: "agentConfig", args: [agentId] });
  progress("Confirm the agent’s spending mandate for your smart account…");
  return submitOwnerAction(connected, { action: "setup", treasuryId, agentName, agentId, version: Number(current + 1n), policy });
}
