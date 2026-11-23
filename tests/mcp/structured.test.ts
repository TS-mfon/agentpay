import { describe, expect, it, vi } from "vitest";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { createAgentPayServer } from "../../mcp/tools";
import { AgentPayClient } from "../../mcp/client";

const address = "0x" + "2".repeat(40);
const requestId = "0x" + "b".repeat(64);
const hash = "0x" + "c".repeat(64);
const treasury = { id: address, owner: address, executor: address, token: address, agentId: hash, agentName: "Household agent", balance: "0.05", reservedBalance: "0.01", availableBalance: "0.04", weeklySpent: "0", totalSpent: "0", active: true, paused: false, policyVersion: 1, keyVersion: 2 };
const policy = { treasuryId: address, agentId: hash, version: 1, mandate: "Pay only household bills", mandateHash: hash, perPaymentLimit: "10", weeklyBudget: "40", totalBudget: "200", validUntil: 1798058297, recipients: [address] };
const payment = { id: requestId, treasuryId: address, agentId: hash, recipient: address, amount: "0.001", amountUnits: "1000", service: "Water bill", purpose: "Pay household water bill", evidence: "Owner-requested test", idempotencyKey: "water-test-001", policyVersion: 1, mandateHash: hash, requestHash: hash, status: "settled", attempts: 3, createdAt: "2026-11-23T20:00:00.000Z", expiresAt: "2026-11-23T21:00:00.000Z", decisionRef: hash, transactionHash: hash };

async function setup() {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    const data = path.endsWith("treasury") ? treasury : path.endsWith("policy") ? policy : path.endsWith("payments") ? [payment] : payment;
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
  it("returns the exact identity, available funds and expiry units as structured content", async () => {
    const s = await setup();
    try {
      const t = await s.call("tools/call", {name: "agentpay_treasury", arguments: {}});
      expect(t.result.structuredContent.data).toMatchObject({id: address, agentId: hash, reservedBalance: "0.01", availableBalance: "0.04"});
      const p = await s.call("tools/call", {name: "agentpay_policy", arguments: {}});
      expect(p.result.structuredContent.data).toMatchObject({validUntil: 1798058297, authorizationExpiresAt: "2026-12-23T20:38:17.000Z"});
      expect(JSON.parse(p.result.content[0].text)).toEqual(p.result.structuredContent);
    } finally { await s.server.close(); }
  });
  it("preserves unknown availability on an older API instead of inventing reservations", async () => {
    const s = await setup();
    const {reservedBalance: _reserved, availableBalance: _available, ...legacyTreasury} = treasury;
    s.fetcher.mockImplementation(async () => new Response(JSON.stringify({success: true, data: legacyTreasury})));
    try {
      const reply = await s.call("tools/call", {name: "agentpay_treasury", arguments: {}});
      expect(reply.result.isError).not.toBe(true);
      expect(reply.result.structuredContent.data.balance).toBe("0.05");
      expect(reply.result.structuredContent.data).not.toHaveProperty("reservedBalance");
      expect(reply.result.structuredContent.data).not.toHaveProperty("availableBalance");
      expect(reply.result.structuredContent.data).not.toHaveProperty("spendableBalance");
    } finally { await s.server.close(); }
  });
  it("preserves every receipt binding and strips undeclared upstream secrets", async () => {
    const s = await setup();
    const rawMarker = globalThis.crypto.randomUUID();
    const credentialMarker = globalThis.crypto.randomUUID();
    s.fetcher.mockImplementation(async () => new Response(JSON.stringify({success: true, data: {...payment, rawTransaction: rawMarker, apiKey: credentialMarker}})));
    try {
      const p = await s.call("tools/call", {name: "agentpay_payment_status", arguments: {id: requestId}});
      expect(p.result.structuredContent.data).toMatchObject({treasuryId: address, agentId: hash, requestHash: hash, mandateHash: hash, policyVersion: 1, decisionRef: hash, transactionHash: hash, amountUnits: "1000"});
      expect(JSON.stringify(p)).not.toContain(rawMarker);
      expect(JSON.stringify(p)).not.toContain(credentialMarker);
    } finally { await s.server.close(); }
  });
  it("does not accept a settled record that omits its settlement or decision reference", async () => {
    const s = await setup();
    try {
      for (const field of ["transactionHash", "decisionRef"]) {
        s.fetcher.mockImplementation(async () => new Response(JSON.stringify({success: true, data: {...payment, [field]: undefined}})));
        const reply = await s.call("tools/call", {name: "agentpay_payment_status", arguments: {id: requestId}});
        expect(reply.result.isError).toBe(true);
        expect(reply.result.structuredContent.error.code).toBe("INVALID_RESPONSE");
      }
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
