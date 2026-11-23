import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createAgentPayServer } from "./tools";
import { AgentPayClient, AgentPayClientError } from "./client";

function main() {
  const client = new AgentPayClient(process.env.AGENTPAY_BASE_URL ?? "", process.env.AGENTPAY_API_KEY ?? "");
  const handle = serveStdio(() => createAgentPayServer(client));
  const shutdown = () => void handle.close().catch(() => { process.exitCode = 1; });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
try { main(); } catch (error) {
  console.error(error instanceof AgentPayClientError ? error.message : "AgentPay MCP could not start. Check its configuration.");
  process.exitCode = 1;
}
