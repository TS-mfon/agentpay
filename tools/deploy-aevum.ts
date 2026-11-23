import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  isHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { aevum, TUSD8_ADDRESS } from "../src/integrations/aevum-config";
loadEnvConfig(process.cwd());
const key = process.env.AEVUM_DEPLOYER_PRIVATE_KEY,
  owner = process.env.AEVUM_OWNER_ADDRESS,
  executor = process.env.AEVUM_EXECUTOR_ADDRESS;
if (
  !key ||
  !isHex(key) ||
  key.length !== 66 ||
  !owner ||
  !isAddress(owner) ||
  !executor ||
  !isAddress(executor)
)
  throw new Error(
    "Configure deployer key and public owner/executor addresses before deployment.",
  );
const account = privateKeyToAccount(key);
const transport = http(
  process.env.AEVUM_RPC_URL || aevum.rpcUrls.default.http[0],
);
const publicClient = createPublicClient({ chain: aevum, transport });
if ((await publicClient.getChainId()) !== 44005)
  throw new Error("Deployment is restricted to Aevum Testnet 44005");
if ((await publicClient.getBalance({ address: account.address })) === 0n)
  throw new Error(`Fund deployer ${account.address} with faucet tQDAY first.`);
const artifact = JSON.parse(
  await readFile("contracts/artifacts/AgentTreasury.json", "utf8"),
);
const bytecode =
  typeof artifact.bytecode === "string"
    ? artifact.bytecode
    : artifact.bytecode.object;
if (!isHex(bytecode) || bytecode === "0x")
  throw new Error("Run npm run build:contracts first");
const client = createWalletClient({ account, chain: aevum, transport });
const hash = await client.deployContract({
  abi: artifact.abi,
  bytecode,
  args: [TUSD8_ADDRESS, owner, executor],
  type: "legacy",
});
console.log(`Deployment transaction: ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({
  hash,
  confirmations: 1,
  timeout: 120_000,
});
if (receipt.status !== "success" || !receipt.contractAddress)
  throw new Error("Aevum deployment did not succeed");
const evidence = {
  network: "QDay Aevum Testnet",
  chainId: 44005,
  contract: receipt.contractAddress,
  transactionHash: hash,
  block: receipt.blockNumber.toString(),
  token: TUSD8_ADDRESS,
  owner,
  executor,
  deployedAt: new Date().toISOString(),
  explorer: `https://explorer-test.qday.info/address/${receipt.contractAddress}`,
};
await mkdir("docs/deployments", { recursive: true });
await writeFile(
  "docs/deployments/aevum.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence, null, 2));
