import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  ".local",
  ".unlazy",
  ".venv",
  "coverage",
  "out",
  "cache",
  "coverage-out",
  "coverage-cache",
  "test-results",
  "playwright-report",
  "__pycache__",
]);
const patterns = [
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /mongodb(?:\+srv)?:\/\/[A-Za-z0-9_.%+-]+:[A-Za-z0-9_%!&*-]+@/,
];
const forbidden = process.argv.find((a) => a.startsWith("--forbid="))?.slice(9);
let count = 0;
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const next = join(path, entry.name);
    if (entry.isDirectory()) await walk(next);
    else if (entry.isFile()) {
      const name = relative(process.cwd(), next);
      if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
        try {
          execFileSync("git", ["check-ignore", "--quiet", name], {
            stdio: "ignore",
          });
          continue;
        } catch {
          throw new Error(`Environment file must stay private: ${name}`);
        }
      }
      if (/\.(png|webm|mp4|ico|deb)$/.test(name)) continue;
      const text = await readFile(next, "utf8");
      if (patterns.some((p) => p.test(text)))
        throw new Error(`Potential credential in ${name}`);
      if (forbidden && new RegExp(forbidden, "i").test(text))
        throw new Error(`Forbidden project reference in ${name}`);
      count++;
    }
  }
}
if (!patterns[0].test("gh" + "p_" + "x".repeat(40)))
  throw new Error("Secret detector positive control failed");
await walk(process.cwd());
try {
  const tracked = execFileSync("git", ["ls-files"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (
    tracked
      .split("\n")
      .some((p) => /(^|\/)\.env(?:$|\.)/.test(p) && !p.endsWith(".env.example"))
  )
    throw new Error("Environment file is tracked");
} catch (error) {
  if (error.status !== 128) throw error;
}
console.log(`Project checks passed (${count} source/configuration files)`);
