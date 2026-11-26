import {
  erc20Abi, getAbiItem, getAddress, isHash, parseEventLogs, TransactionReceiptNotFoundError,
  zeroAddress, type Hex, type Log, type TransactionReceipt,
} from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import { AppError } from "../core/errors";
import { assertOwnerOperationVersion, type OwnerIntent, type OwnerOperationRecord } from "../core/owner-operations";
import { hashText, sameAddress, units } from "../core/validation";
import type { OwnerOperationChain } from "../server/owner-operations";
import { TUSD8_ADDRESS, vaultAbi } from "./aevum-config";
import { assertAevum, ownerNonceKey, qdayBundlerClient, qdayPublicClient, qdaySmartAccount } from "./qday-smart-account";

const operationEvent = getAbiItem({ abi: entryPoint07Abi, name: "UserOperationEvent" });
const maxBlockRange = 1_000n;
type ReceiptStatus = "verified" | "reverted" | "review";

function matchesOwnerAction(logs: Log[], owner: string, intent: OwnerIntent): boolean {
  const vaultLogs = logs.filter(log => sameAddress(log.address, intent.treasuryId));
  const vaultEvents = parseEventLogs({ abi: vaultAbi, logs: vaultLogs });
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer",
    logs: logs.filter(log => sameAddress(log.address, TUSD8_ADDRESS)) });
  const action = intent.action;
  const [first, second] = vaultEvents;

  if (vaultLogs.length !== vaultEvents.length) return false;
  if (action === "fund" || action === "withdraw") {
    if (transfers.length !== 1) return false;
    const amount = units(intent.amount);
    const { from, to, value } = transfers[0].args;
    if (value !== amount) return false;
    if (action === "fund")
      return vaultEvents.length === 0 && sameAddress(from, owner) && sameAddress(to, intent.treasuryId);
    return sameAddress(from, intent.treasuryId) && sameAddress(to, owner) && vaultEvents.length === 1 &&
      first.eventName === "Withdrawn" && sameAddress(first.args.recipient, owner) && first.args.amount === amount;
  }

  if (transfers.length !== 0) return false;
  if (action === "pause")
    return vaultEvents.length === 1 && first.eventName === "PauseChanged" && first.args.paused;
  if (action === "revoke")
    return vaultEvents.length === 1 && first.eventName === "AgentRevoked" &&
      sameAddress(first.args.agentId, intent.agentId) && first.args.policyVersion === BigInt(intent.version);

  const config = action === "resume" ? second : first;
  if (!("policy" in intent) || config?.eventName !== "AgentConfigured") return false;
  if (action === "resume") {
    if (vaultEvents.length !== 2 || first.eventName !== "PauseChanged" || first.args.paused ||
      first.args.authorizationEpoch !== config.args.authorizationEpoch) return false;
  } else if (vaultEvents.length !== 1) return false;

  const { policy, version } = intent;
  const args = config.args;
  return sameAddress(args.agentId, intent.agentId) && args.policyVersion === BigInt(version) &&
    sameAddress(args.mandateHash, hashText(policy.mandate)) && args.perPaymentLimit === units(policy.perPaymentLimit) &&
    args.weeklyBudget === units(policy.weeklyBudget) && args.totalBudget === units(policy.totalBudget) &&
    args.validUntil === BigInt(policy.validUntil) && args.recipients.length === policy.recipients.length &&
    args.recipients.every((recipient, index) => sameAddress(recipient, policy.recipients[index]));
}

function classifyReceipt(receipt: TransactionReceipt, record: OwnerOperationRecord, nonce: bigint): ReceiptStatus | undefined {
  const boundaries = parseEventLogs({ abi: entryPoint07Abi, eventName: ["BeforeExecution", "UserOperationEvent"],
    logs: receipt.logs.filter(log => sameAddress(log.address, qdaySmartAccount.entryPoint)) });
  const matches = boundaries.filter(log => log.eventName === "UserOperationEvent" &&
    sameAddress(log.args.userOpHash, record.hash));
  if (matches.length === 0) return undefined;
  const [event] = matches;
  if (matches.length !== 1 || receipt.status !== "success" || event.eventName !== "UserOperationEvent" ||
    !sameAddress(event.args.sender, record.owner) || event.args.nonce !== nonce ||
    !sameAddress(event.args.paymaster, zeroAddress)) return "review";

  const earlier = boundaries.filter(log => log.logIndex < event.logIndex);
  if (!earlier.some(log => log.eventName === "BeforeExecution")) return "review";
  if (!event.args.success) return "reverted";
  const start = earlier.reduce((latest, log) => Math.max(latest, log.logIndex), -1);
  const operationLogs = receipt.logs.filter(log => log.logIndex > start && log.logIndex < event.logIndex);
  return matchesOwnerAction(operationLogs, record.owner, record.intent) ? "verified" : "review";
}

function provesReplacement(receipt: TransactionReceipt, owner: string, nonce: bigint) {
  if (receipt.status !== "success") return false;
  const events = parseEventLogs({ abi: entryPoint07Abi, eventName: "UserOperationEvent",
    logs: receipt.logs.filter(log => sameAddress(log.address, qdaySmartAccount.entryPoint)) });
  return events.filter(event => sameAddress(event.args.sender, owner) && event.args.nonce === nonce).length === 1;
}

export function createOwnerOperationChain(
  client: ReturnType<typeof qdayPublicClient>,
  bundler = qdayBundlerClient(client),
): OwnerOperationChain {
  const readNonce = (owner: string, blockNumber: bigint) => client.readContract({
    address: qdaySmartAccount.entryPoint, abi: entryPoint07Abi, functionName: "getNonce",
    args: [getAddress(owner), ownerNonceKey], blockNumber,
  });
  async function readReceipt(transactionHash: Hex, confirmedBlock: bigint) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: transactionHash });
      if (!sameAddress(receipt.transactionHash, transactionHash) || receipt.blockNumber > confirmedBlock)
        return undefined;
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      return block.hash === receipt.blockHash ? receipt : undefined;
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return undefined;
      throw error;
    }
  }

  return {
    async check(owner, intent, nonce) {
      await assertAevum(client);
      const { number: blockNumber, hash } = await client.getBlock({ blockTag: "latest" });
      const address = getAddress(intent.treasuryId);
      const snapshot = { address, abi: vaultAbi, blockNumber } as const;
      const [chainOwner, token, currentNonce, config] = await Promise.all([
        client.readContract({ ...snapshot, functionName: "owner" }),
        client.readContract({ ...snapshot, functionName: "token" }),
        readNonce(owner, blockNumber),
        "version" in intent ? client.readContract({ ...snapshot, functionName: "agentConfig", args: [intent.agentId as Hex] }) : undefined,
      ]);
      if ((await client.getBlock({ blockNumber })).hash !== hash)
        throw new AppError("OWNER_OPERATION_STALE", "Aevum updated during verification. Start the owner action again.", 409);
      if (!sameAddress(chainOwner, owner) || !sameAddress(token, TUSD8_ADDRESS))
        throw new AppError("VAULT_MISMATCH", "The vault owner or token does not match.", 403);
      if (currentNonce !== nonce)
        throw new AppError("OWNER_OPERATION_STALE", "The smart-account nonce changed. Start the owner action again.", 409);
      if ("version" in intent && config) {
        const addsPolicy = intent.action === "setup" || intent.action === "policy" || intent.action === "resume";
        assertOwnerOperationVersion(Number(config[0]), addsPolicy ? intent.version - 1 : intent.version);
      }
      return blockNumber;
    },

    async broadcast(operation) {
      const [chainId, entryPoints] = await Promise.all([
        bundler.request({ method: "eth_chainId" }), bundler.getSupportedEntryPoints(),
      ]);
      if (Number(chainId) !== qdaySmartAccount.chainId ||
        !entryPoints.some(entryPoint => sameAddress(entryPoint, qdaySmartAccount.entryPoint)))
        throw new Error("The QDay bundler is not configured for Aevum EntryPoint v0.7.");
      return bundler.request({ method: "eth_sendUserOperation", params: [operation, qdaySmartAccount.entryPoint] }, { retryCount: 0 });
    },

    async inspect(record) {
      await assertAevum(client);
      if (!record.operation) throw new Error("A pending owner operation has no signed envelope.");
      const nonce = BigInt(record.operation.nonce);
      const nextBlock = BigInt(record.nextBlock);
      const pending = (cursor = nextBlock) => ({ status: "pending" as const, nextBlock: cursor });
      const head = await client.getBlock({ blockTag: "latest" });
      const confirmedBlock = head.number - 1n;
      if (nextBlock > confirmedBlock) return pending();
      const hint = await bundler.getUserOperationReceipt({ hash: record.hash }).catch(() => undefined);
      const hintedHash = hint?.receipt?.transactionHash;
      if (hintedHash && isHash(hintedHash)) {
        const receipt = await readReceipt(hintedHash, confirmedBlock);
        const status = receipt && classifyReceipt(receipt, record, nonce);
        if (status) return { status, transactionHash: hintedHash };
      }

      const limit = nextBlock + maxBlockRange - 1n;
      const toBlock = confirmedBlock < limit ? confirmedBlock : limit;
      const logs = await client.getLogs({ address: qdaySmartAccount.entryPoint, event: operationEvent,
        args: { userOpHash: record.hash }, fromBlock: nextBlock, toBlock, strict: true });
      if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) return pending();
      if (logs.length) {
        const { transactionHash, blockHash } = logs[0];
        const receipt = await readReceipt(transactionHash, confirmedBlock);
        if (!receipt || receipt.blockHash !== blockHash) return pending();
        const status = logs.length > 1 ? "review" : classifyReceipt(receipt, record, nonce) ?? "review";
        return { status, transactionHash };
      }

      const currentNonce = await readNonce(record.owner, toBlock);
      if (currentNonce === nonce) {
        if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) return pending();
        return pending(toBlock === confirmedBlock ? toBlock : toBlock + 1n);
      }
      if (currentNonce < nonce) return pending();

      // Nonce consumption is visible in state before its logs can be indexed.
      const events = await client.getLogs({ address: qdaySmartAccount.entryPoint, event: operationEvent,
        args: { sender: getAddress(record.owner) }, fromBlock: nextBlock, toBlock, strict: true });
      const candidates = events.filter(event => event.args.nonce === nonce);
      if (candidates.length !== 1) return pending();
      const { transactionHash, blockHash } = candidates[0];
      const receipt = await readReceipt(transactionHash, confirmedBlock);
      if (!receipt || receipt.blockHash !== blockHash ||
        (await client.getBlock({ blockNumber: head.number })).hash !== head.hash) return pending();
      const status = classifyReceipt(receipt, record, nonce);
      if (status) return { status, transactionHash };
      return provesReplacement(receipt, record.owner, nonce) ? { status: "replaced" } : pending();
    },
  };
}
