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
import { api } from "./api";
import type { DashboardData, OwnerAction, Policy } from "./types";
const chain = {
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-test.qday.info"] } },
  blockExplorers: {
    default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" },
  },
} as const;
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
function provider(): EIP1193Provider {
  const ethereum = (window as unknown as { ethereum?: EIP1193Provider })
    .ethereum;
  if (!ethereum)
    throw new Error("Install a browser wallet to connect to Aevum Testnet.");
  return ethereum;
}
async function client() {
  const wallet = createWalletClient({ chain, transport: custom(provider()) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("Select a wallet account to continue.");
  try {
    await wallet.switchChain({ id: chain.id });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await wallet.addChain({ chain });
    await wallet.switchChain({ id: chain.id });
  }
  return { wallet, account };
}
export async function connectOwner(): Promise<string> {
  const { wallet, account } = await client();
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
  const { wallet, account } = await client();
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
  const { wallet, account } = await client();
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
  createNew: boolean,
  progress: (message: string) => void,
  onVaultCreated?: (address: string) => void,
): Promise<string> {
  const { wallet, account } = await client();
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
