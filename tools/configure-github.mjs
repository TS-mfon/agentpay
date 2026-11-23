import nextEnv from "@next/env";
import { spawnSync } from "node:child_process";
nextEnv.loadEnvConfig(process.cwd());
const repository = "TS-mfon/agentpay";
const environment = spawnSync(
  "gh",
  [
    "api",
    "--method",
    "PUT",
    `repos/${repository}/environments/agentpay-testnet`,
  ],
  { input: "{}", encoding: "utf8" },
);
if (environment.status !== 0)
  throw new Error("Could not create the scoped testnet execution environment");
for (const name of [
  "MONGODB_URI",
  "AEVUM_EXECUTOR_PRIVATE_KEY",
  "GENLAYER_OPERATOR_PRIVATE_KEY",
]) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  const result = spawnSync(
    "gh",
    ["secret", "set", name, "--repo", repository, "--env", "agentpay-testnet"],
    { input: value, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      (result.stderr || `Failed ${name}`).replaceAll(value, "[redacted]"),
    );
  console.log(`Configured execution secret ${name}`);
}
const variables = {
  AGENTPAY_DATABASE: "agentpay",
  AEVUM_EXECUTOR_ADDRESS: process.env.AEVUM_EXECUTOR_ADDRESS,
  GENLAYER_CONTRACT_ADDRESS: process.env.GENLAYER_CONTRACT_ADDRESS,
};
for (const [name, value] of Object.entries(variables)) {
  if (!value) throw new Error(`Missing ${name}`);
  const result = spawnSync(
    "gh",
    [
      "variable",
      "set",
      name,
      "--repo",
      repository,
      "--env",
      "agentpay-testnet",
      "--body",
      value,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`Failed public variable ${name}`);
  console.log(`Configured execution variable ${name}`);
}
