import nextEnv from "@next/env";
import { spawnSync } from "node:child_process";
nextEnv.loadEnvConfig(process.cwd());
const environment = process.argv.includes("--production") ? "production" : "preview";
const values = {
  AGENTPAY_MODE: "live",
  MONGODB_URI: process.env.MONGODB_URI,
  AGENTPAY_DATABASE: "agentpay",
  AEVUM_EXECUTOR_ADDRESS: process.env.AEVUM_EXECUTOR_ADDRESS,
  GENLAYER_NETWORK: "studio-dev",
  GENLAYER_CONTRACT_ADDRESS: process.env.GENLAYER_CONTRACT_ADDRESS,
  AGENTPAY_SHOWCASE_TREASURY: process.env.AGENTPAY_SHOWCASE_TREASURY,
  AGENTPAY_SERVICES_JSON: process.env.AGENTPAY_SERVICES_JSON || "[]",
  ...(environment === "production" ? { APP_ORIGIN: "https://agentpay-roan.vercel.app" } : {}),
};
for (const [name, value] of Object.entries(values)) {
  if (!value) throw new Error(`Missing ${name}`);
  const args = [
    "env",
    "add",
    name,
    "--environment",
    environment,
    "--scope",
    "gen-daves-projects",
    "--yes",
    "--force",
  ];
  if (name === "MONGODB_URI") args.push("--sensitive");
  const result = spawnSync("vercel", args, {
    input: value + "\n",
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(
      (result.stderr || `Failed to add ${name}`).replaceAll(
        value,
        "[redacted]",
      ),
    );
  console.log(`Configured ${environment} variable ${name}`);
}
console.log(
  `${environment} environment configured; signing keys were not sent to Vercel.`,
);
