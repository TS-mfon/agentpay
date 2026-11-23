import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  formatUnits,
  keccak256,
  isAddress,
  isHex,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Payment, Treasury } from "../core/types";
import type { Settlement, VaultSnapshot } from "../core/ports";
import {
  AEVUM_CHAIN_ID,
  TUSD8_ADDRESS,
  TOKEN_DECIMALS,
  aevum,
  vaultAbi,
} from "./aevum-config";

const bytes32 = (value: string): Hex => {
  if (!isHex(value) || value.length !== 66)
    throw new Error("Invalid on-chain request reference");
  return value as Hex;
};
export function createAevumSettlement(): Settlement {
  const rpc = process.env.AEVUM_RPC_URL || aevum.rpcUrls.default.http[0];
  if (!rpc.startsWith("https://") && process.env.NODE_ENV === "production")
    throw new Error("Aevum RPC must use HTTPS");
  const client = createPublicClient({
    chain: aevum,
    transport: http(rpc, { timeout: 15_000, retryCount: 1 }),
  });
  const account = process.env.AEVUM_EXECUTOR_PRIVATE_KEY
    ? privateKeyToAccount(bytes32(process.env.AEVUM_EXECUTOR_PRIVATE_KEY))
    : undefined;
  const wallet = account
    ? createWalletClient({
        account,
        chain: aevum,
        transport: http(rpc, { timeout: 15_000, retryCount: 1 }),
      })
    : undefined;
  const verifyChain = async () => {
    if ((await client.getChainId()) !== AEVUM_CHAIN_ID)
      throw new Error("RPC is not Aevum Testnet");
  };
  const read = <T>(
    address: Address,
    functionName: string,
    args: readonly unknown[] = [],
  ) =>
    client.readContract({
      address,
      abi: vaultAbi,
      functionName,
      args,
    } as Parameters<typeof client.readContract>[0]) as Promise<T>;
  return {
    async snapshot(
      treasury: Treasury,
      recipients: string[] = [],
    ): Promise<VaultSnapshot> {
      await verifyChain();
      if (!isAddress(treasury.id)) throw new Error("Invalid treasury address");
      const address = treasury.id as Address;
      const agent = bytes32(treasury.agentId);
      const [owner, executor, token, paused, config, active, spent] =
        await Promise.all([
          read<Address>(address, "owner"),
          read<Address>(address, "executor"),
          read<Address>(address, "token"),
          read<boolean>(address, "paused"),
          read<readonly [bigint, Hex, bigint, bigint, bigint, bigint, boolean]>(
            address,
            "agentConfig",
            [agent],
          ),
          read<boolean>(address, "isAgentActive", [agent]),
          read<readonly [bigint, bigint, bigint]>(address, "spentBudgets", [
            agent,
          ]),
        ]);
      if (token.toLowerCase() !== TUSD8_ADDRESS.toLowerCase())
        throw new Error("Vault token is not Aevum tUSD8");
      const [balance, decimals] = await Promise.all([
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]);
      if (decimals !== TOKEN_DECIMALS)
        throw new Error("Unexpected tUSD8 token decimals");
      if (account && executor.toLowerCase() !== account.address.toLowerCase())
        throw new Error("Configured signer is not the vault executor");
      const permitted = await Promise.all(
        recipients.map(async (recipient) => {
          if (!isAddress(recipient)) return null;
          const allowed = await read<boolean>(address, "isRecipientAllowed", [
            agent,
            recipient as Address,
          ]);
          return allowed ? recipient : null;
        }),
      );
      const amount = (n: bigint) => formatUnits(n, TOKEN_DECIMALS);
      return {
        owner,
        executor,
        token,
        balance: amount(balance),
        paused,
        active,
        policyVersion: Number(config[0]),
        mandateHash: config[1],
        perPaymentLimit: amount(config[2]),
        weeklyBudget: amount(config[3]),
        totalBudget: amount(config[4]),
        validUntil: Number(config[5]),
        week: Number(spent[0]),
        recipients: permitted.filter((r): r is Address => r !== null),
        weeklySpent: amount(spent[1]),
        totalSpent: amount(spent[2]),
      };
    },
    async prepare(treasury, payment) {
      await verifyChain();
      if (!wallet || !account)
        throw new Error(
          "Execution signing is available only on the configured worker",
        );
      if (!payment.decisionRef || !payment.approvalExpiresAt)
        throw new Error("Missing finalized approval");
      const args = [
        bytes32(payment.id),
        bytes32(payment.agentId),
        BigInt(payment.policyVersion),
        payment.recipient as Address,
        BigInt(payment.amountUnits),
        BigInt(payment.approvalExpiresAt),
        bytes32(payment.requestHash),
        bytes32(payment.decisionRef),
      ] as const;
      const simulated = await client.simulateContract({
        account,
        address: treasury.id as Address,
        abi: vaultAbi,
        functionName: "executePayment",
        args,
      });
      const { encodeFunctionData } = await import("viem");
      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "executePayment",
        args: simulated.request.args,
      });
      const nonce = await client.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      const tx = await wallet.prepareTransactionRequest({
        account,
        chain: aevum,
        to: treasury.id as Address,
        data,
        value: 0n,
        type: "legacy",
        nonce,
      });
      const rawTransaction = await account.signTransaction(tx);
      return { hash: keccak256(rawTransaction), rawTransaction };
    },
    async broadcast(rawTransaction) {
      await verifyChain();
      if (!isHex(rawTransaction))
        throw new Error("Invalid prepared transaction");
      return client.sendRawTransaction({
        serializedTransaction: rawTransaction,
      });
    },
    async reconcile(payment: Payment) {
      await verifyChain();
      const hash = payment.transactionHash;
      if (hash) {
        try {
          const receipt = await client.getTransactionReceipt({
            hash: bytes32(hash),
          });
          if (receipt.status !== "success")
            return { status: "failed" as const, transactionHash: hash };
          const { decodeEventLog } = await import("viem");
          const matches = receipt.logs
            .filter(
              (log) =>
                log.address.toLowerCase() === payment.treasuryId.toLowerCase(),
            )
            .some((log) => {
              try {
                const event = decodeEventLog({
                  abi: vaultAbi,
                  data: log.data,
                  topics: log.topics,
                });
                if (event.eventName !== "PaymentExecuted") return false;
                const args = event.args as {
                  requestId: Hex;
                  recipient: Address;
                  amount: bigint;
                  requestHash: Hex;
                  policyVersion: bigint;
                  agentId: Hex;
                  decisionRef: Hex;
                };
                return (
                  args.requestId === payment.id &&
                  args.requestHash === payment.requestHash &&
                  args.agentId === payment.agentId &&
                  args.policyVersion === BigInt(payment.policyVersion) &&
                  args.decisionRef === payment.decisionRef &&
                  args.recipient.toLowerCase() ===
                    payment.recipient.toLowerCase() &&
                  args.amount === BigInt(payment.amountUnits)
                );
              } catch {
                return false;
              }
            });
          if (!matches)
            throw new Error(
              "Successful transaction did not emit the expected payment receipt",
            );
          return { status: "settled" as const, transactionHash: hash };
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/TransactionReceiptNotFound/.test(error.name)
          )
            throw error;
        }
        try {
          await client.getTransaction({ hash: bytes32(hash) });
          return { status: "pending" as const, transactionHash: hash };
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/TransactionNotFound/.test(error.name)
          )
            throw error;
        }
      }
      const alreadyExecuted = await read<boolean>(
        payment.treasuryId as Address,
        "executed",
        [bytes32(payment.id)],
      );
      if (alreadyExecuted)
        throw new Error(
          "Request settled on-chain but stored transaction reference needs reconciliation",
        );
      return { status: "not_found" as const };
    },
  };
}
