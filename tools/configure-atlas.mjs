import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const argument = (name) =>
  process.argv.find((x) => x.startsWith(name + "="))?.slice(name.length + 1);
const projectId = argument("--project-id"),
  host = argument("--host");
if (
  !projectId ||
  !/^[a-f0-9]{24}$/.test(projectId) ||
  !host ||
  !/^[a-z0-9.-]+\.mongodb\.net$/.test(host)
)
  throw new Error("Provide the exact new Atlas project ID and SRV host.");
await mkdir(".local", { recursive: true });
let saved;
try {
  saved = JSON.parse(await readFile(".local/atlas-credentials.json", "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (saved && saved.projectId !== projectId)
  throw new Error("Local credentials are scoped to a different project.");
const credentials = saved || {
  projectId,
  host,
  username: "agentpay_app",
  password: randomBytes(32).toString("base64url"),
  created: false,
};
await writeFile(".local/atlas-credentials.json", JSON.stringify(credentials), {
  mode: 0o600,
});
if (!credentials.created) {
  const result = spawnSync(
    "atlas",
    [
      "dbusers",
      "create",
      "--username",
      credentials.username,
      "--password",
      credentials.password,
      "--role",
      "readWrite@agentpay,readWrite@agentpay_demo",
      "--scope",
      "agentpay-free",
      "--projectId",
      projectId,
      "--profile",
      "agentpay",
      "--output",
      "json",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      (result.stderr || "Atlas database-user creation failed").replaceAll(
        credentials.password,
        "[redacted]",
      ),
    );
  credentials.created = true;
  await writeFile(
    ".local/atlas-credentials.json",
    JSON.stringify(credentials),
    { mode: 0o600 },
  );
}
const uri = `mongodb+srv://${credentials.username}:${encodeURIComponent(credentials.password)}@${host}/?retryWrites=true&w=majority&appName=AgentPay`;
let env = "";
try {
  env = await readFile(".env.local", "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const [name, value] of Object.entries({
  MONGODB_URI: uri,
  AGENTPAY_DATABASE: "agentpay",
})) {
  env =
    env
      .split("\n")
      .filter((line) => !line.startsWith(name + "="))
      .join("\n")
      .trimEnd() +
    "\n" +
    name +
    "=" +
    JSON.stringify(value) +
    "\n";
}
await writeFile(".env.local", env, { mode: 0o600 });
console.log(
  "Configured Atlas database-scoped user and private local connection settings. No credential values printed.",
);
