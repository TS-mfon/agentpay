"use client";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseAbi,
  parseUnits,
  keccak256,
  toBytes,
  type Address,
  type EIP1193Provider,
} from "viem";
import { aevum as chain } from "../integrations/aevum-config";
import { api } from "./api";
import type { DashboardData, OwnerAction, Policy } from "./types";
const vaultAbi = parseAbi([
  "function owner() view returns(address)",
  "function token() view returns(address)",
  "function agentConfig(bytes32 agentId) view returns(uint256 policyVersion,bytes32 mandateHash,uint256 perPaymentLimit,uint256 weeklyBudget,uint256 totalBudget,uint256 validUntil,bool active)",
  "constructor(address tokenAddress,address initialOwner,address initialExecutor)",
  "function withdraw(address recipient,uint256 amount)",
  "function setPaused(bool value)",
  "function revokeAgent(bytes32 agentId)",
  "function configureAgent(bytes32 agentId,uint256 policyVersion,bytes32 mandateHash,uint256 perPaymentLimit,uint256 weeklyBudget,uint256 totalBudget,uint256 validUntil,address[] recipients)",
]);
function browserWallet() {
  const ethereum = (window as unknown as { ethereum?: EIP1193Provider })
    .ethereum;
  if (!ethereum)
    throw new Error("Install a browser wallet to connect to Aevum Testnet.");
  const transport = custom(ethereum);
  return { wallet: createWalletClient({ chain, transport }), transport };
}

function networkErrorCodes(error: unknown) {
  const codes = new Set<number>();
  const seen = new Set<object>();
  const pending = [error];
  for (const item of pending) {
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const { code, cause, data } = item as { code?: unknown; cause?: unknown; data?: { originalError?: unknown } };
    if (typeof code === "number") codes.add(code);
    pending.push(cause, data?.originalError);
  }
  return codes;
}

const switchManually = "Select QDay Aevum Testnet in your wallet, then try again. If it’s missing, use the wallet setup guide.";

async function selectAevum(wallet: ReturnType<typeof browserWallet>["wallet"]) {
  let adding = false;
  try {
    if (await wallet.getChainId() === chain.id) return false;
    try {
      await wallet.switchChain({ id: chain.id });
    } catch (error) {
      const codes = networkErrorCodes(error);
      if (!codes.has(4902) || codes.has(4001) || codes.has(-32002)) throw error;
      adding = true;
      await wallet.addChain({ chain });
      adding = false;
      if (await wallet.getChainId() === chain.id) return true;
      await wallet.switchChain({ id: chain.id });
    }
    if (await wallet.getChainId() === chain.id) return true;
  } catch (error) {
    const codes = networkErrorCodes(error);
    if (codes.has(4001)) throw new Error(adding ? "Adding Aevum Testnet was declined. Approve it in your wallet to continue."
      : "The network switch was declined. Approve it in your wallet to continue.");
    if (codes.has(-32002)) throw new Error("Open your wallet to finish the pending network request.");
    if (codes.has(4100)) throw new Error("Connect your wallet to AgentPay and try switching the network again.");
    throw new Error(switchManually, { cause: error });
  }
  throw new Error(switchManually);
}

export async function switchToAevum() {
  await selectAevum(browserWallet().wallet);
}

export async function connectBrowserWallet() {
  const { wallet, transport } = browserWallet();
  const [selected] = await wallet.requestAddresses();
  if (!selected) throw new Error("Select a wallet account to continue.");
  const switched = await selectAevum(wallet);
  const [account] = switched ? await wallet.getAddresses() : [selected];
  if (!account) throw new Error("Select a wallet account on Aevum Testnet to continue.");
  return { wallet, transport, account };
}
export async function connectOwner(): Promise<string> {
  const { wallet, account } = await connectBrowserWallet();
  const challenge = await api<{ nonce: string; message: string }>(
    `/api/auth/nonce?address=${account}`,
  );
  const signature = await wallet.signMessage({
    account,
    message: challenge.message,
  });
  await api("/api/auth/verify", {
    address: account,
    nonce: challenge.nonce,
    signature,
  });
  return account;
}
async function confirmed(hash: `0x${string}`): Promise<string> {
  const rpc = createPublicClient({ chain, transport: http() });
  const receipt = await rpc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error(
      "The Aevum transaction reverted. No control change was applied.",
    );
  return hash;
}
export async function walletControl(
  data: DashboardData,
  action: OwnerAction,
  amount?: string,
): Promise<string> {
  const { wallet, account } = await connectBrowserWallet();
  if (account.toLowerCase() !== data.treasury.owner.toLowerCase())
    throw new Error("Connect the treasury owner's wallet.");
  const common = {
    account,
    chain,
    address: data.treasury.id as Address,
    abi: vaultAbi,
  };
  if (action === "fund")
    return confirmed(
      await wallet.writeContract({
        account,
        chain,
        address: data.treasury.token as Address,
        abi: parseAbi([
          "function transfer(address to,uint256 amount) returns(bool)",
        ]),
        functionName: "transfer",
        args: [data.treasury.id as Address, parseUnits(amount ?? "0", 6)],
      }),
    );
  if (action === "withdraw")
    return confirmed(
      await wallet.writeContract({
        ...common,
        functionName: "withdraw",
        args: [account, parseUnits(amount ?? "0", 6)],
      }),
    );
  if (action === "pause")
    return confirmed(
      await wallet.writeContract({
        ...common,
        functionName: "setPaused",
        args: [true],
      }),
    );
  if (action === "resume") {
    await confirmed(
      await wallet.writeContract({
        ...common,
        functionName: "setPaused",
        args: [false],
      }),
    );
    return configurePolicy(data, data.policy);
  }
  if (action === "revoke")
    return confirmed(
      await wallet.writeContract({
        ...common,
        functionName: "revokeAgent",
        args: [data.treasury.agentId as `0x${string}`],
      }),
    );
  return configurePolicy(data, data.policy);
}
async function nextPolicyVersion(data: DashboardData): Promise<bigint> {
  const rpc = createPublicClient({ chain, transport: http(undefined, { timeout: 15000, retryCount: 1 }) });
  const current = await rpc.readContract({
    address: data.treasury.id as Address,
    abi: vaultAbi,
    functionName: "agentConfig",
    args: [data.treasury.agentId as `0x${string}`],
    blockTag: "latest",
  });
  const registered = BigInt(data.policy.version);
  return (current[0] > registered ? current[0] : registered) + 1n;
}

export async function configurePolicy(
  data: DashboardData,
  policy: Omit<Policy, "version" | "mandateHash">,
): Promise<string> {
  const { wallet, account } = await connectBrowserWallet();
  if (account.toLowerCase() !== data.treasury.owner.toLowerCase())
    throw new Error("Connect the treasury owner's wallet.");
  const version = await nextPolicyVersion(data);
  return confirmed(
    await wallet.writeContract({
      account,
      chain,
      address: data.treasury.id as Address,
      abi: vaultAbi,
      functionName: "configureAgent",
      args: [
        data.treasury.agentId as `0x${string}`,
        version,
        keccak256(toBytes(policy.mandate.trim())),
        parseUnits(policy.perPaymentLimit, 6),
        parseUnits(policy.weeklyBudget, 6),
        parseUnits(policy.totalBudget, 6),
        BigInt(policy.validUntil),
        policy.recipients as Address[],
      ],
    }),
  );
}

export interface TreasurySetup {
  treasuryId: string;
  agentName: string;
  mandate: string;
  perPaymentLimit: string;
  weeklyBudget: string;
  totalBudget: string;
  validUntil: number;
  recipients: string[];
}
export async function prepareTreasury(
  input: TreasurySetup,
  ownerAddress: string,
  createNew: boolean,
  progress: (message: string) => void,
  onVaultCreated?: (address: string) => void,
): Promise<string> {
  const { wallet, account } = await connectBrowserWallet();
  if (account.toLowerCase() !== ownerAddress.toLowerCase())
    throw new Error("Connect the wallet you used to sign in.");
  const config = await api<{
    mode: string;
    token: string;
    executor: string | null;
    vaultBytecode?: string;
  }>("/api/config");
  if (config.mode !== "live")
    throw new Error("Treasury deployment is available in live Aevum mode.");
  let treasuryId = input.treasuryId as Address;
  const rpc = createPublicClient({ chain, transport: http() });
  if (createNew) {
    if (
      !config.executor ||
      !/^0x[0-9a-fA-F]{40}$/.test(config.executor) ||
      !config.vaultBytecode ||
      !/^0x[0-9a-fA-F]+$/.test(config.vaultBytecode)
    )
      throw new Error(
        "The deployment configuration is incomplete. Configure the executor and build the vault contract first.",
      );
    progress("Confirm treasury creation in your wallet…");
    const hash = await wallet.deployContract({
      account,
      chain,
      abi: vaultAbi,
      bytecode: config.vaultBytecode as `0x${string}`,
      args: [config.token as Address, account, config.executor as Address],
    });
    const receipt = await rpc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error(
        "Treasury creation failed. Check your wallet's testnet gas balance.",
      );
    treasuryId = receipt.contractAddress;
    onVaultCreated?.(treasuryId);
  }
  const [owner, token] = await Promise.all([
    rpc.readContract({
      address: treasuryId,
      abi: vaultAbi,
      functionName: "owner",
    }),
    rpc.readContract({
      address: treasuryId,
      abi: vaultAbi,
      functionName: "token",
    }),
  ]);
  if (
    owner.toLowerCase() !== account.toLowerCase() ||
    token.toLowerCase() !== config.token.toLowerCase()
  )
    throw new Error(
      "The vault must belong to your wallet and use Aevum tUSD8.",
    );
  const agentId = keccak256(
    toBytes(`agentpay:${treasuryId.toLowerCase()}:${input.agentName.trim()}`),
  );
  const current = await rpc.readContract({
    address: treasuryId,
    abi: vaultAbi,
    functionName: "agentConfig",
    args: [agentId],
  });
  progress("Confirm the agent's spending mandate in your wallet…");
  await confirmed(
    await wallet.writeContract({
      account,
      chain,
      address: treasuryId,
      abi: vaultAbi,
      functionName: "configureAgent",
      args: [
        agentId,
        current[0] + 1n,
        keccak256(toBytes(input.mandate.trim())),
        parseUnits(input.perPaymentLimit, 6),
        parseUnits(input.weeklyBudget, 6),
        parseUnits(input.totalBudget, 6),
        BigInt(input.validUntil),
        input.recipients as Address[],
      ],
    }),
  );
  return treasuryId;
}
