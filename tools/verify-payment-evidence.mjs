import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPublicClient, http, erc20Abi, parseAbi, parseAbiItem,
  decodeEventLog, keccak256, stringToHex, parseUnits,
} from "viem";
import { createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";

const flags = process.argv.slice(2);
if (flags.some(flag => flag !== "--aevum-only")) {
  throw new Error("Usage: node tools/verify-payment-evidence.mjs [--aevum-only]");
}
const aevumOnly = flags.includes("--aevum-only");
const manifest = JSON.parse(await readFile(new URL(
  "../docs/evidence/household-payments-2026-11-24.json", import.meta.url,
), "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.networks.settlement.assetAddress.toLowerCase(), "0x456569838f1d43009a91eba4263147afd7233483", "Evidence must use the official Aevum tUSD8 contract");
assert.equal(manifest.payments.length, 3, "Expected the three recorded owner-authorized tests");
const qday = createPublicClient({
  transport: http("https://rpc-test.qday.info", { timeout: 15000, retryCount: 1 }),
});
const governance = aevumOnly ? undefined : createClient({ chain: studioDevnet });
const sameAddress = (left, right) => left?.toLowerCase() === right?.toLowerCase();
const paymentEvent = parseAbiItem("event PaymentExecuted(bytes32 indexed requestId, bytes32 indexed agentId, uint256 indexed policyVersion, address recipient, uint256 amount, bytes32 requestHash, bytes32 decisionRef, uint256 authorizationEpoch)");
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const timeout = setTimeout(() => {
  console.error("Public read-only evidence verification exceeded its 90-second deadline.");
  process.exit(1);
}, 90000);

function eventsAt(logs, address, event) {
  return logs.filter(log => sameAddress(log.address, address)).flatMap(log => {
    try {
      return [decodeEventLog({ abi: [event], data: log.data, topics: log.topics }).args];
    } catch {
      return [];
    }
  });
}

function verifyRequest(payment) {
  const input = payment.input;
  const requestId = keccak256(stringToHex([
    payment.treasuryId.toLowerCase(), payment.agentId, input.idempotencyKey,
  ].join(":")));
  assert.equal(requestId, payment.requestId, "Purchase key/agent/vault identity differs");
  const requestHash = keccak256(stringToHex(JSON.stringify({
    treasuryId: payment.treasuryId.toLowerCase(), agentId: payment.agentId,
    policyVersion: payment.policyVersion, mandateHash: payment.mandateHash,
    recipient: input.recipient.toLowerCase(), amount: input.amount, service: input.service,
    purpose: input.purpose, evidence: input.evidence, idempotencyKey: input.idempotencyKey,
  })));
  assert.equal(requestHash, payment.requestHash, "Normalized request body differs");
  assert.equal(parseUnits(input.amount, 6), BigInt(payment.amountUnits));
}

async function verifyGovernance(payment) {
  const reference = payment.governance.transactionHash;
  const transaction = await governance.getTransaction({ hash: reference });
  assert.equal(transaction.statusName, "FINALIZED", "GenLayer decision is not finalized");
  assert.ok(isSuccessful(transaction), "GenLayer execution was not successful");
  const policyKey = `${payment.treasuryId.toLowerCase()}:${payment.agentId.toLowerCase()}:${payment.policyVersion}`;
  const read = async (functionName, args) => governance.readContract({
    address: manifest.networks.governance.contract, functionName, args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL, jsonSafeReturn: true,
  });
  const decision = JSON.parse(await read("get_decision", [payment.requestId]));
  for (const [field, expected] of Object.entries({
    request_id: payment.requestId, policy_key: policyKey,
    policy_version: payment.policyVersion, request_hash: payment.requestHash,
    mandate_hash: payment.mandateHash, status: "approved",
  })) assert.equal(decision[field], expected, `GenLayer ${field} binding differs`);
  const policy = JSON.parse(await read("get_policy", [policyKey]));
  assert.equal(keccak256(stringToHex(policy.text)), payment.mandateHash);
}

async function verifySettlement(payment) {
  const reference = payment.settlement.transactionHash;
  const [receipt, transaction] = await Promise.all([
    qday.getTransactionReceipt({ hash: reference }), qday.getTransaction({ hash: reference }),
  ]);
  assert.equal(receipt.status, "success", "Aevum transaction was not successful");
  assert.ok(sameAddress(transaction.to, payment.treasuryId));
  assert.ok(sameAddress(transaction.from, payment.settlement.executor));
  assert.equal(transaction.nonce, payment.settlement.executorNonce);
  assert.equal(receipt.blockNumber.toString(), payment.settlement.blockNumber);
  const records = eventsAt(receipt.logs, payment.treasuryId, paymentEvent);
  assert.equal(records.length, 1, "Expected exactly one vault PaymentExecuted record");
  const record = records[0];
  for (const [field, expected] of Object.entries({
    requestId: payment.requestId, agentId: payment.agentId,
    requestHash: payment.requestHash, decisionRef: payment.governance.transactionHash,
  })) assert.equal(record[field], expected, `Vault ${field} binding differs`);
  assert.equal(record.policyVersion, BigInt(payment.policyVersion));
  assert.equal(record.amount, BigInt(payment.amountUnits));
  assert.ok(sameAddress(record.recipient, payment.input.recipient));
  const transfers = eventsAt(receipt.logs, manifest.networks.settlement.assetAddress, transferEvent)
    .filter(event => sameAddress(event.from, payment.treasuryId));
  assert.equal(transfers.length, 1, "Expected exactly one outgoing official-token transfer");
  assert.ok(sameAddress(transfers[0].to, payment.input.recipient));
  assert.equal(transfers[0].value, BigInt(payment.amountUnits));
}

async function verifyAccounting() {
  const { treasuryId, agentId } = manifest.authorization;
  const assetAddress = manifest.networks.settlement.assetAddress;
  const snapshot = manifest.accountingSnapshot;
  assert.equal(await qday.readContract({ address: assetAddress, abi: erc20Abi, functionName: "decimals" }), 6);
  const balance = blockNumber => qday.readContract({
    address: assetAddress, abi: erc20Abi, functionName: "balanceOf", args: [treasuryId], blockNumber,
  });
  const [before, after, spent] = await Promise.all([
    balance(BigInt(snapshot.beforeBlock)), balance(BigInt(snapshot.afterBlock)),
    qday.readContract({ address: treasuryId,
      abi: parseAbi(["function spentBudgets(bytes32 agentId) view returns(uint256 week,uint256 weekly,uint256 total)"]),
      functionName: "spentBudgets", args: [agentId], blockNumber: BigInt(snapshot.afterBlock),
    }),
  ]);
  assert.equal(before, BigInt(snapshot.beforeBalanceUnits));
  assert.equal(after, BigInt(snapshot.afterBalanceUnits));
  assert.equal(before - after, BigInt(snapshot.totalTransferredUnits));
  assert.equal(spent[1], BigInt(snapshot.weeklySpentUnits));
  assert.equal(spent[2], BigInt(snapshot.lifetimeSpentUnits));
}

try {
  assert.equal(await qday.getChainId(), 44005);
  if (governance) assert.equal(Number(await governance.request({ method: "eth_chainId" })), 61997);
  for (const payment of manifest.payments) {
    verifyRequest(payment);
    if (governance) await verifyGovernance(payment);
    await verifySettlement(payment);
  }
  await verifyAccounting();
  assert.equal(new Set(manifest.payments.map(payment => payment.settlement.executorNonce)).size, 3);
  console.log(JSON.stringify({
    verifiedAt: new Date().toISOString(), scope: aevumOnly ? "Aevum settlement only" : "GenLayer and Aevum",
    governanceVerified: !aevumOnly, settlementVerified: true, verifiedPayments: manifest.payments.length,
    transferredUnits: manifest.accountingSnapshot.totalTransferredUnits,
    balanceAtSnapshotUnits: manifest.accountingSnapshot.afterBalanceUnits,
    snapshotBlock: manifest.accountingSnapshot.afterBlock,
    note: "Read-only checks; no transaction was submitted. Historical snapshot, not a current-balance promise.",
  }, null, 2));
} catch (error) {
  console.error("Evidence verification failed or the selected development/testnet record is unavailable.");
  console.error(error instanceof Error ? error.message : "Unknown verification error");
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
