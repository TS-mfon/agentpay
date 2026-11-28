import { describe, expect, it, vi } from "vitest";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { createAgentPayServer } from "../../mcp/tools";
import { AgentPayClient } from "../../mcp/client";

const address = "0x" + "2".repeat(40);
const requestId = "0x" + "b".repeat(64);
const hash = "0x" + "c".repeat(64);
const policy = { treasuryId: address, agentId: hash, version: 1, mandate: "Pay only household bills", mandateHash: hash, perPaymentLimit: "10", weeklyBudget: "40", totalBudget: "200", validUntil: 1798058297, recipients: [address] };
const payment = { id: requestId, treasuryId: address, agentId: hash, recipient: address, amount: "0.001", amountUnits: "1000", service: "Water bill", purpose: "Pay household water bill", evidence: "Owner-requested test", idempotencyKey: "water-test-001", policyVersion: 1, mandateHash: hash, requestHash: hash, status: "settled", attempts: 3, createdAt: "2026-11-23T20:00:00.000Z", expiresAt: "2026-11-23T21:00:00.000Z", decisionRef: hash, transactionHash: hash };

async function setup() {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    const data = path.endsWith("payments") ? [payment] : payment;
    return new Response(JSON.stringify({success: true, data}));
  });
  const client = new AgentPayClient("https://agentpay.example", "ap_" + "a".repeat(43), {fetch: fetcher});
  const server = createAgentPayServer(client);
  const [caller, transport] = InMemoryTransport.createLinkedPair();
  let nextId = 0;
  const call = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, any>>((resolve) => {
    const id = ++nextId;
    caller.onmessage = (message: JSONRPCMessage) => { if ("id" in message && message.id === id) resolve(message as Record<string, any>); };
    void caller.send({jsonrpc: "2.0", id, method, params});
  });
  await server.connect(transport); await caller.start();
  await call("initialize", {protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {name: "schema-test", version: "1"}});
  await caller.send({jsonrpc: "2.0", method: "notifications/initialized"});
  return {server, call, fetcher};
}

describe("MCP structured payment contract", () => {
  it("advertises output schemas for every existing tool", async () => {
    const s = await setup();
    try { const reply = await s.call("tools/list"); expect(reply.result.tools.every((t: any) => t.outputSchema?.type === "object")).toBe(true); }
    finally { await s.server.close(); }
  });
  it("keeps Aevum receipt bindings and strips private fields even from an older upstream", async () => {
    const s = await setup();
    const rawMarker = globalThis.crypto.randomUUID();
    const credentialMarker = globalThis.crypto.randomUUID();
    s.fetcher.mockImplementation(async () => new Response(JSON.stringify({ success: true, data: {
      ...payment, ...policy, decisionReason: "PRIVATE_DECISION", error: "PRIVATE_ERROR",
      rawTransaction: rawMarker, apiKey: credentialMarker,
    } })));
    try {
      const p = await s.call("tools/call", {name: "agentpay_payment_status", arguments: {id: requestId}});
      const data = p.result.structuredContent.data;
      expect(data).toMatchObject({treasuryId: address, agentId: hash, requestHash: hash, policyVersion: 1, transactionHash: hash, amountUnits: "1000"});
      for (const key of ["mandate", "mandateHash", "weeklyBudget", "totalBudget", "perPaymentLimit", "decisionRef", "decisionReason", "error", "purpose", "evidence", "service"])
        expect(data).not.toHaveProperty(key);
      expect(JSON.parse(p.result.content[0].text)).toEqual(p.result.structuredContent);
      expect(JSON.stringify(p)).not.toContain(rawMarker);
      expect(JSON.stringify(p)).not.toContain(credentialMarker);
    } finally { await s.server.close(); }
  });
  it("keeps simulated settlements and failed transactions distinct from a verified receipt", async () => {
    const s = await setup();
    try {
      for (const example of [
        { status: "settled", transactionHash: "simulation:" + requestId, expected: undefined },
        { status: "failed", transactionHash: hash, expected: hash },
        { status: "settled", transactionHash: hash, expected: hash },
      ]) {
        s.fetcher.mockImplementation(async () => new Response(JSON.stringify({ success: true, data: {
          ...payment, status: example.status, transactionHash: example.transactionHash, decisionRef: undefined,
        } })));
        const reply = await s.call("tools/call", { name: "agentpay_payment_status", arguments: { id: requestId } });
        expect(reply.result.isError).not.toBe(true);
        const data = reply.result.structuredContent.data;
        expect(data.status).toBe(example.status);
        expect(data.transactionHash).toBe(example.expected);
        expect(data.requestHash).toBe(example.status === "settled" && example.expected ? hash : undefined);
      }
    } finally { await s.server.close(); }
  });
  it("fails safely when an Aevum settlement is missing its purchase binding", async () => {
    const s = await setup();
    try {
      s.fetcher.mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { ...payment, requestHash: undefined } })));
      const reply = await s.call("tools/call", { name: "agentpay_payment_status", arguments: { id: requestId } });
      expect(reply.result.structuredContent.error.code).toBe("INVALID_RESPONSE");
    } finally { await s.server.close(); }
  });
  it("fails safely on an upstream record that cannot satisfy the payment schema", async () => {
    const s = await setup();
    s.fetcher.mockImplementation(async () => new Response(JSON.stringify({success: true, data: {status: "settled", privateKey: "PRIVATE_VALUE"}})));
    try {
      const p = await s.call("tools/call", {name: "agentpay_payment_status", arguments: {id: requestId}});
      expect(p.result.isError).toBe(true);
      expect(JSON.stringify(p)).not.toContain("PRIVATE_VALUE");
    } finally { await s.server.close(); }
  });
});
