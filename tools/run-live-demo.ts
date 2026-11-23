import nextEnv from "@next/env";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { getRuntime } from "../src/server/runtime";
nextEnv.loadEnvConfig(process.cwd());
const policy = JSON.parse(
  await readFile(".local/live-demo-policy.json", "utf8"),
);
const owner = process.env.AEVUM_OWNER_ADDRESS;
if (!owner || process.env.AGENTPAY_MODE !== "live")
  throw new Error(
    "Live demo requires the configured owner and explicit live mode",
  );
const { service } = await getRuntime();
let dashboard = await service.dashboard(owner);
if (!dashboard.treasury) {
  await service.setup(owner, policy);
  dashboard = await service.dashboard(owner);
}
if (dashboard.treasury?.id.toLowerCase() !== policy.treasuryId.toLowerCase())
  throw new Error("Existing owner treasury differs from the demonstration");
const credential = await service.issueCredential(owner);
await writeFile(
  ".local/live-agent-credential.json",
  JSON.stringify(credential),
  { mode: 0o600 },
);
const recipient = policy.recipients[0];
const research = await service.requestPayment(owner, {
  recipient,
  amount: "0.1",
  service: "Research API",
  purpose: "Buy research data for the authorized market research task",
  evidence:
    "Sample research API invoice: dataset access serves market research. The service returns the dataset after a confirmed payment.",
  idempotencyKey: "agentpay-live-research-001",
});
const unrelated = await service.requestPayment(owner, {
  recipient,
  amount: "0.1",
  service: "Gaming subscription",
  purpose: "Purchase a gaming entertainment subscription",
  evidence: "Entertainment invoice for gaming, with no research purpose.",
  idempotencyKey: "agentpay-live-unrelated-001",
});
console.log(`Live requests queued: ${research.id}, ${unrelated.id}`);
const deadline = Date.now() + 12 * 60_000;
while (Date.now() < deadline) {
  await service.processBatch(4);
  dashboard = await service.dashboard(owner);
  const a = dashboard.payments.find((p) => p.id === research.id),
    b = dashboard.payments.find((p) => p.id === unrelated.id);
  console.log(
    JSON.stringify({
      research: a?.status,
      unrelated: b?.status,
      at: new Date().toISOString(),
    }),
  );
  if (a?.status === "settled" && b?.status === "rejected") {
    await mkdir("docs/deployments", { recursive: true });
    const evidence = {
      network: "Aevum Testnet",
      chainId: 44005,
      treasury: policy.treasuryId,
      genlayerContract: process.env.GENLAYER_CONTRACT_ADDRESS,
      genlayerNetwork: process.env.GENLAYER_NETWORK,
      research: a,
      unrelated: b,
      verifiedAt: new Date().toISOString(),
    };
    await writeFile(
      "docs/deployments/live-payments.json",
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(
      "Real approval, tUSD8 settlement, receipt and semantic rejection verified.",
    );
    process.exit(0);
  }
  if (
    a?.status === "failed" ||
    a?.status === "expired" ||
    b?.status === "failed" ||
    b?.status === "expired"
  )
    throw new Error("Live workflow failed closed; inspect request status.");
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
throw new Error(
  "Live workflow still pending. Reconcile stored requests; do not recreate them.",
);
