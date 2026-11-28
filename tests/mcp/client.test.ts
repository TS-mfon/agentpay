import { describe, expect, it, vi } from "vitest";
import { AgentPayClient, AgentPayClientError } from "../../mcp/client";
import { agentPaymentFixture, paymentFixture } from "./fixtures";
const requestId = "0x" + "b".repeat(64);
const key = "ap_" + "a".repeat(43);
const recipient = "0x2222222222222222222222222222222222222222";
const input = { recipient, amount: "4", service: "Research API", purpose: "Purchase relevant research", evidence: "Invoice 123", idempotencyKey: "research-job-001" };
const fetchOk = () => vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify({success:true,data:paymentFixture()}), {headers:{"content-type":"application/json"}}));

describe("AgentPay MCP API client", () => {
  it("scopes bearer authentication to a fixed HTTPS origin and forbids redirects", async () => {
    const fetcher = fetchOk();
    const client = new AgentPayClient("https://agentpay.example/", key, {fetch: fetcher});
    await client.payment(requestId);
    expect(fetcher).toHaveBeenCalledWith("https://agentpay.example/api/v1/payments/" + requestId, expect.objectContaining({redirect:"error",headers:expect.objectContaining({Authorization:`Bearer ${key}`})}));
  });
  it.each(["https://user:pass@agentpay.example", "https://agentpay.example/?key=secret", "https://agentpay.example/path", "http://agentpay.example", "file:///etc/passwd"])("rejects unsafe base configuration %s", (url) => {
    expect(() => new AgentPayClient(url,key)).toThrow(AgentPayClientError);
  });
  it("allows explicit local HTTP for development", () => {
    expect(() => new AgentPayClient("http://127.0.0.1:3000",key)).not.toThrow();
  });
  it("requires an agent-scoped API credential", () => {
    expect(() => new AgentPayClient("https://agentpay.example","private-key")).toThrow(AgentPayClientError);
  });
  it("preserves idempotency fields and exact decimal amounts when submitting", async () => {
    const fetcher=fetchOk(); const client=new AgentPayClient("https://agentpay.example",key,{fetch:fetcher});
    await client.requestPayment({...input,amount:"0.000001"});
    const opts=fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(opts.method).toBe("POST");
    expect(JSON.parse(String(opts.body))).toEqual({...input,amount:"0.000001"});
  });
  it("validates fields before touching the network", async () => {
    const fetcher=fetchOk(); const client=new AgentPayClient("https://agentpay.example",key,{fetch:fetcher});
    await expect(client.requestPayment({...input,amount:"-1"})).rejects.toThrow(AgentPayClientError);
    await expect(client.requestPayment({...input,amount:"0"})).rejects.toThrow(AgentPayClientError);
    await expect(client.requestPayment({...input,token:"anything"})).rejects.toThrow(AgentPayClientError);
    await expect(client.payment("../../secret")).rejects.toThrow(AgentPayClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not leak credentials or response details in errors", async () => {
    const fetcher=vi.fn(async(_url: string | URL | Request, _options?: RequestInit)=>new Response(JSON.stringify({success:false,error:{code:"UNAUTHORIZED",message:key}}),{status:401}));
    const client=new AgentPayClient("https://agentpay.example",key,{fetch:fetcher});
    await expect(client.payment(requestId)).rejects.toThrow("Agent credential is invalid, expired, or revoked.");
    const network=new AgentPayClient("https://agentpay.example",key,{fetch:vi.fn(async()=>{throw new Error(key);})});
    await expect(network.payment(requestId)).rejects.toThrow("AgentPay could not be reached. Retrieve payment status before retrying a submission.");
  });
  it("limits history without adding unsupported pagination parameters", async () => {
    const fetcher=vi.fn(async(_url: string | URL | Request, _options?: RequestInit)=>new Response(JSON.stringify({success:true,data:[paymentFixture(),paymentFixture("0x"+"d".repeat(64))]})));
    const client=new AgentPayClient("https://agentpay.example",key,{fetch:fetcher});
    expect(await client.history(1)).toEqual([agentPaymentFixture()]);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://agentpay.example/api/v1/payments");
  });
  it("rejects malformed and excessive upstream responses", async () => {
    const client=new AgentPayClient("https://agentpay.example",key,{fetch:vi.fn(async(_url: string | URL | Request, _options?: RequestInit)=>new Response("not JSON"))});
    await expect(client.payment(requestId)).rejects.toThrow("AgentPay returned an invalid response.");
    const large=new AgentPayClient("https://agentpay.example",key,{fetch:vi.fn(async(_url: string | URL | Request, _options?: RequestInit)=>new Response("x".repeat(1_500_001)))});
    await expect(large.payment(requestId)).rejects.toThrow("AgentPay response exceeds the local size limit.");
  });
  it("rejects invalid history limits and unexpected upstream history shapes", async () => {
    const fetcher=fetchOk(); const client=new AgentPayClient("https://agentpay.example",key,{fetch:fetcher});
    await expect(client.history(0)).rejects.toThrow("History limit");
    await expect(client.history(101)).rejects.toThrow("History limit");
    await expect(client.history(1)).rejects.toThrow("AgentPay returned an invalid response.");
  });
  it("rejects unexpected successful response envelopes", async () => {
    for(const payload of [null, {}, {success:false}, {success:true}]) {
      const client=new AgentPayClient("https://agentpay.example",key,{fetch:vi.fn(async()=>new Response(JSON.stringify(payload)))});
      await expect(client.payment(requestId)).rejects.toThrow("AgentPay returned an invalid response.");
    }
  });
  it("bounds upstream error codes and uses safe messages for errors", async () => {
    for(const status of [400,403,404,409,429,503]) {
      const client=new AgentPayClient("https://agentpay.example",key,{fetch:vi.fn(async()=>new Response(JSON.stringify({success:false,error:{code:key,message:key}}),{status}))});
      try { await client.payment(requestId); throw new Error("Expected failure"); }
      catch(error) { expect(error).toBeInstanceOf(AgentPayClientError); expect((error as AgentPayClientError).code).toBe("REQUEST_FAILED"); expect((error as Error).message).not.toContain(key); }
    }
  });
  it("retrieves a valid request by its request ID", async () => {
    const fetcher=fetchOk(); const client=new AgentPayClient("https://agentpay.example",key,{fetch:fetcher});
    const id="0x"+"b".repeat(64); await client.payment(id);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://agentpay.example/api/v1/payments/"+id);
  });
  it("bounds local call frequency", async () => {
    const client=new AgentPayClient("https://agentpay.example",key,{fetch:fetchOk(),now:()=>1000});
    for(let i=0;i<60;i++) await client.payment(requestId);
    await expect(client.payment(requestId)).rejects.toThrow("Too many local tool calls. Wait a minute before retrying.");
  });
});

describe("MCP actionable spending errors", () => {
  it.each([
    ["RECIPIENT_NOT_ALLOWED", "approved recipient"],
    ["INSUFFICIENT_BALANCE", "pending commitments"],
    ["PAYMENT_LIMIT", "per-payment"],
    ["WEEKLY_BUDGET", "weekly"],
    ["TOTAL_BUDGET", "lifetime"],
    ["IDEMPOTENCY_CONFLICT", "exact original payload"],
  ])("explains %s without forwarding an upstream secret", async (code, explanation) => {
    const client = new AgentPayClient("https://agentpay.example", key, {fetch: vi.fn(async () => new Response(JSON.stringify({success: false, error: {code, message: key}}), {status: code === "IDEMPOTENCY_CONFLICT" ? 409 : 400}))});
    try { await client.requestPayment(input); throw new Error("Expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(AgentPayClientError);
      expect((error as AgentPayClientError).code).toBe(code);
      expect((error as Error).message).toContain(explanation);
      expect((error as Error).message).not.toContain(key);
    }
  });
});

describe("MCP transport diagnostics", () => {
  it("distinguishes the bounded request timeout without leaking failure details", async () => {
    const client = new AgentPayClient("https://agentpay.example", key, {fetch: vi.fn(async () => { throw new DOMException(key, "TimeoutError"); })});
    try { await client.requestPayment(input); throw new Error("Expected timeout"); }
    catch (error) {
      expect(error).toBeInstanceOf(AgentPayClientError);
      expect((error as AgentPayClientError).code).toBe("REQUEST_TIMEOUT");
      expect((error as Error).message).toContain("15-second");
      expect((error as Error).message).not.toContain(key);
    }
  });
  it("retains the actual HTTP status for safe actionable API errors", async () => {
    const client = new AgentPayClient("https://agentpay.example", key, {fetch: vi.fn(async () => new Response(JSON.stringify({success: false, error: {code: "RECIPIENT_NOT_ALLOWED"}}), {status: 403}))});
    try { await client.requestPayment(input); throw new Error("Expected rejection"); }
    catch (error) { expect((error as AgentPayClientError & {httpStatus?: number}).httpStatus).toBe(403); }
  });
});
