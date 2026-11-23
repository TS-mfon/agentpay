import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createClient, createAccount, isSuccessful } from "genlayer-js";
import { governanceChain } from "../src/integrations/genlayer-network";
import { isHex, isAddress } from "viem";
loadEnvConfig(process.cwd());
const key = process.env.GENLAYER_OPERATOR_PRIVATE_KEY;
if (!key || !isHex(key) || key.length !== 66)
  throw new Error("Configure a dedicated governance operator key.");
const account = createAccount(key);
const chain = governanceChain();
const client = createClient({
  chain,
  account,
  endpoint: process.env.GENLAYER_RPC_URL || undefined,
});
const code = await readFile("governance/AgentMandate.py", "utf8");
const estimate = await client.estimateTransactionFees();
const hash = await client.deployContract({
  code,
  args: [],
  leaderOnly: false,
  fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
});
console.log(`Governance deployment transaction: ${hash}`);
const receipt = await client.waitForTransactionReceipt({
  hash: hash as Parameters<typeof client.waitForTransactionReceipt>[0]["hash"],
  waitUntil: "finalized",
  interval: 5000,
  retries: 60,
});
if (!isSuccessful(receipt))
  throw new Error("Governance deployment did not finalize successfully");
const decoded = receipt.txDataDecoded as
  { contractAddress?: string } | undefined;
const candidate = receipt.data?.contract_address ?? decoded?.contractAddress;
if (typeof candidate !== "string" || !isAddress(candidate))
  throw new Error(
    `Finalized transaction ${hash}; resolve its deployed contract address from the official explorer before configuration.`,
  );
const evidence = {
  network: chain.name,
  chainId: chain.id,
  contract: candidate,
  transactionHash: hash,
  operator: account.address,
  deployedAt: new Date().toISOString(),
};
await mkdir("docs/deployments", { recursive: true });
await writeFile(
  "docs/deployments/genlayer.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence, null, 2));
