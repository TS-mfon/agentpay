import { describe, expect, it, vi } from "vitest";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { createAgentPayServer } from "../../mcp/tools";
import { AgentPayClient } from "../../mcp/client";

async function setup() {
  const fetcher = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify({success:true,data:{id:"0x"+"b".repeat(64),status:"queued"}})));
  const client = new AgentPayClient("https://agentpay.example", "ap_" + "a".repeat(43), {fetch:fetcher});
  const server = createAgentPayServer(client);
  const [caller, transport] = InMemoryTransport.createLinkedPair();
  let nextId=0;
  const call = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, any>>((resolve) => {
    const id=++nextId;
    caller.onmessage = (message: JSONRPCMessage) => { if ("id" in message && message.id === id) resolve(message as Record<string, any>); };
    void caller.send({jsonrpc:"2.0",id,method,params});
  });
  await server.connect(transport);
  await caller.start();
  await call("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"test",version:"1"}});
  await caller.send({jsonrpc:"2.0",method:"notifications/initialized"});
  return {server,caller,call,fetcher,client};
}
describe("AgentPay MCP tool protocol", () => {
  it("advertises 5 scoped tools with payment side effects identified", async () => {
    const s=await setup();
    try {
      const result=await s.call("tools/list");
      expect(result.result.tools.map((tool:any)=>tool.name)).toEqual(["agentpay_treasury","agentpay_policy","agentpay_request_payment","agentpay_payment_status","agentpay_payment_history"]);
      const spend=result.result.tools.find((tool:any)=>tool.name==="agentpay_request_payment");
      expect(spend.annotations.readOnlyHint).toBe(false);
      expect(spend.annotations.destructiveHint).toBe(true);
      expect(spend.description).toContain("payment");
    } finally {await s.server.close();}
  });
  it("rejects malicious request references before fetching", async () => {
    const s=await setup();
    try {
      const result=await s.call("tools/call",{name:"agentpay_payment_status",arguments:{id:"../../secrets"}});
      expect(result.result.isError).toBe(true);
      expect(s.fetcher).not.toHaveBeenCalled();
    } finally {await s.server.close();}
  });
  it("routes all read tools to their authorized API and bounds history", async () => {
    const s=await setup();
    try {
      for(const name of ["agentpay_treasury","agentpay_policy","agentpay_payment_status"]) {
        const args=name==="agentpay_payment_status" ? {id:"0x"+"b".repeat(64)} : {};
        const reply=await s.call("tools/call",{name,arguments:args});
        expect(reply.result.isError).not.toBe(true);
      }
      s.fetcher.mockImplementation(async()=>new Response(JSON.stringify({success:true,data:[{id:"one"},{id:"two"}]})));
      const history=await s.call("tools/call",{name:"agentpay_payment_history",arguments:{limit:1}});
      expect(JSON.parse(history.result.content[0].text).data).toEqual([{id:"one"}]);
    } finally {await s.server.close();}
  });
  it("reports API denial and unexpected failures without leaking details", async () => {
    const s=await setup();
    try {
      s.fetcher.mockImplementation(async()=>new Response(JSON.stringify({success:false,error:{code:"UNAUTHORIZED",message:"secret-value"}}),{status:401}));
      const denied=await s.call("tools/call",{name:"agentpay_treasury",arguments:{}});
      expect(denied.result.isError).toBe(true);
      expect(denied.result.content[0].text).not.toContain("secret-value");
      vi.spyOn(s.client,"treasury").mockRejectedValue(new Error("internal-secret"));
      const failed=await s.call("tools/call",{name:"agentpay_treasury",arguments:{}});
      expect(failed.result.isError).toBe(true);
      expect(failed.result.content[0].text).toContain("TOOL_FAILED");
      expect(failed.result.content[0].text).not.toContain("internal-secret");
    } finally {await s.server.close();}
  });
  it("submits an authenticated request through the real API adapter", async () => {
    const s=await setup();
    try {
      const result=await s.call("tools/call",{name:"agentpay_request_payment",arguments:{recipient:"0x2222222222222222222222222222222222222222",amount:"4",service:"Research API",purpose:"Research approved markets",evidence:"Invoice",idempotencyKey:"purchase-job-001"}});
      expect(result.result.isError).not.toBe(true);
      expect(s.fetcher.mock.calls[0]?.[0]).toBe("https://agentpay.example/api/v1/payments");
    } finally {await s.server.close();}
  });
});
