import nextEnv from "@next/env";
import { readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  keccak256,
  toBytes,
  parseUnits,
  isHex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { aevum, TUSD8_ADDRESS } from "../src/integrations/aevum-config";
nextEnv.loadEnvConfig(process.cwd());
const deployment = JSON.parse(
  await readFile("docs/deployments/aevum.json", "utf8"),
);
const key = process.env.AEVUM_DEPLOYER_PRIVATE_KEY;
if (!key || !isHex(key))
  throw new Error("Dedicated deployment-owner key is required");
const owner = privateKeyToAccount(key);
if (owner.address.toLowerCase() !== deployment.owner.toLowerCase())
  throw new Error("Demo preparation key is not the vault owner");
let merchant;
try {
  merchant = JSON.parse(await readFile(".local/merchant-wallet.json", "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const privateKey = generatePrivateKey();
  merchant = { address: privateKeyToAccount(privateKey).address, privateKey };
  await writeFile(".local/merchant-wallet.json", JSON.stringify(merchant), {
    mode: 0o600,
    flag: "wx",
  });
}
const client = createPublicClient({
  chain: aevum,
  transport: http(aevum.rpcUrls.default.http[0]),
});
const wallet = createWalletClient({
  chain: aevum,
  account: owner,
  transport: http(aevum.rpcUrls.default.http[0]),
});
const artifact = JSON.parse(
  await readFile("contracts/artifacts/AgentTreasury.json", "utf8"),
);
const agentName = "Research scout";
const agentId = keccak256(
  toBytes("agentpay:" + deployment.contract.toLowerCase() + ":" + agentName),
);
const mandate =
  "You are a market research agent. Pay only approved recipients for research APIs, market datasets, and compute used for research. Do not pay for gaming, entertainment, or unrelated services. Maximum 10 tUSD8 per payment, 40 tUSD8 per Unix week, and 100 tUSD8 in total.";
const mandateHash = keccak256(toBytes(mandate));
const config = (await client.readContract({
  address: deployment.contract,
  abi: artifact.abi,
  functionName: "agentConfig",
  args: [agentId],
})) as readonly [bigint, string, bigint, bigint, bigint, bigint, boolean];
let validUntil = Math.floor(Date.now() / 1000) + 30 * 86400;
if (config[0] === 0n) {
  const hash = await wallet.writeContract({
    address: deployment.contract,
    abi: artifact.abi,
    functionName: "configureAgent",
    args: [
      agentId,
      1n,
      mandateHash,
      parseUnits("10", 6),
      parseUnits("40", 6),
      parseUnits("100", 6),
      BigInt(validUntil),
      [merchant.address],
    ],
    type: "legacy",
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error("Owner configuration failed");
  console.log(`Agent mandate configured on Aevum: ${hash}`);
} else {
  if (config[1] !== mandateHash)
    throw new Error(
      "Existing mandate differs; do not overwrite it automatically",
    );
  validUntil = Number(config[5]);
}
const balance = await client.readContract({
  address: TUSD8_ADDRESS,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [owner.address],
});
const vaultBalance = await client.readContract({
  address: TUSD8_ADDRESS,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [deployment.contract],
});
console.log(
  JSON.stringify({
    owner: owner.address,
    merchant: merchant.address,
    ownerTokenBalance: balance.toString(),
    vaultTokenBalance: vaultBalance.toString(),
  }),
);
if (vaultBalance < parseUnits("20", 6) && balance >= parseUnits("40", 6)) {
  const hash = await wallet.writeContract({
    address: TUSD8_ADDRESS,
    abi: erc20Abi,
    functionName: "transfer",
    args: [deployment.contract, parseUnits("40", 6)],
    type: "legacy",
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Treasury funding failed");
  console.log(`Vault funded with 40 tUSD8: ${hash}`);
}
const policy = {
  treasuryId: deployment.contract,
  agentName,
  mandate,
  perPaymentLimit: "10",
  weeklyBudget: "40",
  totalBudget: "100",
  validUntil,
  recipients: [merchant.address],
};
await writeFile(
  ".local/live-demo-policy.json",
  JSON.stringify(policy, null, 2) + "\n",
);
const services = [
  {
    id: "research",
    name: "Research API",
    description:
      "Owner-operated sample research dataset API; access after settled payment",
    recipient: merchant.address,
    amount: "0.1",
    purpose: "Buy research data for the authorized market research task",
    evidence:
      "Sample service invoice: research dataset access delivered by the AgentPay research API after confirmed settlement.",
  },
  {
    id: "unrelated",
    name: "Gaming subscription",
    description: "A purpose outside the research mandate",
    recipient: merchant.address,
    amount: "0.1",
    purpose: "Purchase a gaming entertainment subscription",
    evidence: "Entertainment invoice; no research purpose.",
  },
];
let env = await readFile(".env.local", "utf8");
env =
  env
    .split("\n")
    .filter((line) => !line.startsWith("AGENTPAY_SERVICES_JSON="))
    .join("\n")
    .trimEnd() +
  "\nAGENTPAY_SERVICES_JSON=" +
  JSON.stringify(services) +
  "\n";
await writeFile(".env.local", env, { mode: 0o600 });
console.log(
  "Saved original demo policy and service catalog locally. No credentials printed.",
);
