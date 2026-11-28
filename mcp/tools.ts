import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { paymentSchema } from "../src/core/validation";
import { AgentPayClient, AgentPayClientError } from "./client";
import { paymentOutput, historyOutput, successOutput } from "./schemas";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
async function result<T>(action: () => Promise<T>) {
  try {
    const output = { success: true as const, data: await action() };
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
  } catch (error) {
    const safe = error instanceof AgentPayClientError ? { code: error.code, message: error.message, ...(error.httpStatus === undefined ? {} : {httpStatus: error.httpStatus}) } : { code: "TOOL_FAILED", message: "The tool could not complete. Check payment status before retrying a submission." };
    const output = { success: false as const, error: safe };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
  }
}
export function createAgentPayServer(client: AgentPayClient) {
  const server = new McpServer({ name: "agentpay", version: "0.3.0" }, { maxToolInputElements: 32 });
  server.registerTool("agentpay_request_payment", {
    title: "Request a governed payment",
    description: "Submit a tUSD8 payment request for an owner-approved recipient and amount. Funds may move after finalized GenLayer approval and Aevum checks. Save the exact payload and stable idempotency key. Service, purpose and evidence are shared with GenLayer. Omit private personal data.",
    inputSchema: paymentSchema.extend({
      recipient: paymentSchema.shape.recipient.describe("Recipient address confirmed by the owner for this purchase"),
      amount: paymentSchema.shape.amount.describe("Positive tUSD8 decimal string with at most six decimal places; amounts of zero are rejected"),
      evidence: paymentSchema.shape.evidence.describe("Optional bounded plain text shared with GenLayer; redact private invoice and personal details"),
      idempotencyKey: paymentSchema.shape.idempotencyKey.describe("Persist this stable 8-100 character key and the exact payload before submitting; retry both unchanged after response loss"),
    }),
    outputSchema: successOutput(paymentOutput),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, (input) => result(() => client.requestPayment(input)));
  server.registerTool("agentpay_payment_status", {
    title: "Read payment status",
    description: "Read a payment's status by AgentPay request ID. For settled live payments, use the Aevum transaction hash to verify the vault event and tUSD8 transfer against the request and amount. A failed or executing payment with a hash still requires receipt review before resubmitting.",
    inputSchema: z.object({ id: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("32-byte hexadecimal AgentPay request ID") }).strict(),
    outputSchema: successOutput(paymentOutput), annotations: readOnly,
  }, ({ id }) => result(() => client.payment(id)));
  server.registerTool("agentpay_payment_history", {
    title: "Read payment history",
    description: "Read only this agent's recent requests, newest first. Increase limit up to 100 to reconcile a lost response; there is no cursor or idempotency-key search endpoint. If the original ID is unknown, retry only the exact saved payload/key, never create a new key to guess whether a payment happened.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20).describe("Maximum recent records to return; local slice of the API's bounded history") }).strict(),
    outputSchema: successOutput(historyOutput), annotations: readOnly,
  }, ({ limit }) => result(() => client.history(limit)));
  return server;
}
