import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { paymentSchema } from "../src/core/validation";
import { AgentPayClient, AgentPayClientError } from "./client";
import { treasuryOutput, policyOutput, paymentOutput, historyOutput, successOutput, withAuthorizationDate } from "./schemas";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
async function result<T>(action: () => Promise<unknown>, schema: z.ZodType<T>) {
  try {
    const parsed = schema.safeParse(await action());
    if (!parsed.success) throw new AgentPayClientError("INVALID_RESPONSE", "AgentPay returned a record that does not match the documented output schema. Do not infer payment completion; inspect the original request with the owner.");
    const output = { success: true as const, data: parsed.data };
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
  } catch (error) {
    const safe = error instanceof AgentPayClientError ? { code: error.code, message: error.message, ...(error.httpStatus === undefined ? {} : {httpStatus: error.httpStatus}) } : { code: "TOOL_FAILED", message: "The tool could not complete. Check payment status before retrying a submission." };
    const output = { success: false as const, error: safe };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
  }
}
export function createAgentPayServer(client: AgentPayClient) {
  const server = new McpServer({ name: "agentpay", version: "0.2.0" }, { maxToolInputElements: 32 });
  server.registerTool("agentpay_treasury", {
    title: "Read agent treasury",
    description: "Read only this credential's agent and vault, raw tUSD8 balance, pending reservedBalance, availableBalance and spending caps when supported by the API. Missing availability fields mean unknown, never zero. This does not transfer funds or select another owner's agent.",
    outputSchema: successOutput(treasuryOutput), annotations: readOnly,
  }, () => result(async () => withAuthorizationDate(await client.treasury()), treasuryOutput));
  server.registerTool("agentpay_policy", {
    title: "Read spending mandate",
    description: "Read this agent's mandate, immutable version/hash, limits and approved recipient addresses. validUntil uses Unix seconds; authorizationExpiresAt is ISO UTC. An approved address is not independently verified merchant identity; ask the owner when its intended payee is unknown.",
    outputSchema: successOutput(policyOutput), annotations: readOnly,
  }, () => result(async () => withAuthorizationDate(await client.policy()), policyOutput));
  server.registerTool("agentpay_request_payment", {
    title: "Request a governed payment",
    description: "Submit a tUSD8 payment request that may spend funds after finalized GenLayer approval and Aevum checks. Read mandate, available balance and approved recipients first. Amount must be a positive decimal string with at most six places; persist the original payload and idempotency key. Service, purpose and evidence are disclosed to GenLayer: omit private personal data. Returns a request, not a paid receipt.",
    inputSchema: paymentSchema.extend({
      recipient: paymentSchema.shape.recipient.describe("Owner-approved recipient from the current policy; an address alone does not prove merchant identity"),
      amount: paymentSchema.shape.amount.describe("Positive tUSD8 decimal string with at most six decimal places; amounts of zero are rejected"),
      evidence: paymentSchema.shape.evidence.describe("Optional bounded plain text shared with GenLayer; redact private invoice and personal details"),
      idempotencyKey: paymentSchema.shape.idempotencyKey.describe("Persist this stable 8-100 character key and the exact payload before submitting; retry both unchanged after response loss"),
    }),
    outputSchema: successOutput(paymentOutput),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, (input) => result(() => client.requestPayment(input), paymentOutput));
  server.registerTool("agentpay_payment_status", {
    title: "Read payment status",
    description: "Read this agent's request and current decision/settlement references using its request ID, not a transaction hash. Pending is not paid. For settled, verify transactionHash's successful Aevum receipt and PaymentExecuted fields against id, treasuryId, agentId, recipient, amountUnits, policyVersion, requestHash and decisionRef. No worker-health or next-run guarantee is returned.",
    inputSchema: z.object({ id: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("32-byte hexadecimal AgentPay request ID") }).strict(),
    outputSchema: successOutput(paymentOutput), annotations: readOnly,
  }, ({ id }) => result(() => client.payment(id), paymentOutput));
  server.registerTool("agentpay_payment_history", {
    title: "Read payment history",
    description: "Read only this agent's recent requests, newest first. Increase limit up to 100 to reconcile a lost response; there is no cursor or idempotency-key search endpoint. If the original ID is unknown, retry only the exact saved payload/key, never create a new key to guess whether a payment happened.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20).describe("Maximum recent records to return; local slice of the API's bounded history") }).strict(),
    outputSchema: successOutput(historyOutput), annotations: readOnly,
  }, ({ limit }) => result(() => client.history(limit), historyOutput));
  return server;
}
