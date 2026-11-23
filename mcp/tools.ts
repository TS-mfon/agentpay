import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { paymentSchema } from "../src/core/validation";
import { AgentPayClient, AgentPayClientError } from "./client";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
async function result(action: () => Promise<unknown>) {
  try {
    const data = await action();
    return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, data }) }] };
  } catch (error) {
    const safe = error instanceof AgentPayClientError ? { code: error.code, message: error.message } : { code: "TOOL_FAILED", message: "The tool could not complete. Check payment status before retrying a submission." };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: safe }) }] };
  }
}
export function createAgentPayServer(client: AgentPayClient) {
  const server = new McpServer({ name: "agentpay", version: "0.1.0" }, { maxToolInputElements: 32 });
  server.registerTool("agentpay_treasury", {
    title: "Read agent treasury", description: "Retrieve the agent's authorized treasury, tUSD8 balance, active state, and settled spending. Does not transfer funds.", annotations: readOnly,
  }, () => result(() => client.treasury()));
  server.registerTool("agentpay_policy", {
    title: "Read spending mandate", description: "Retrieve the current natural-language mandate, policy version, expiry, hard limits, and approved recipients for this agent.", annotations: readOnly,
  }, () => result(() => client.policy()));
  server.registerTool("agentpay_request_payment", {
    title: "Request a governed payment",
    description: "Submit a tUSD8 payment request that may spend treasury funds after finalized GenLayer approval and Aevum contract checks. Requires owner-authorized purpose and a stable idempotency key. Returns a queued request, not a settlement receipt.",
    inputSchema: paymentSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, (input) => result(() => client.requestPayment(input)));
  server.registerTool("agentpay_payment_status", {
    title: "Read payment status", description: "Retrieve an existing payment request, its policy decision, explanation, and Aevum receipt if settled. Use the returned request ID, not a transaction hash.",
    inputSchema: z.object({ id: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("32-byte hexadecimal AgentPay request ID") }).strict(), annotations: readOnly,
  }, ({ id }) => result(() => client.payment(id)));
  server.registerTool("agentpay_payment_history", {
    title: "Read payment history", description: "Retrieve the agent's most recent payment requests and decisions. The limit is applied locally; the API currently has no pagination cursor.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20).describe("Maximum recent records to return") }).strict(), annotations: readOnly,
  }, ({ limit }) => result(() => client.history(limit)));
  return server;
}
