import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type RequestListener } from "node:http";
import { startGovernanceRpcProxy } from "../../src/server/governance-rpc-proxy";

let resources: Array<{ close(): Promise<void> }> = [];
async function upstream(handler: RequestListener) {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  resources = [...resources, { close: () => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  }) }];
  return `http://127.0.0.1:${address.port}/api`;
}
const call = (endpoint: string, body: { jsonrpc: string; id: number; method: string; params: unknown[] } =
  { jsonrpc: "2.0", id: 1, method: "gen_call", params: [] }) =>
  fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
afterEach(async () => {
  const closing = resources;
  resources = [];
  await Promise.all(closing.map((resource) => resource.close()));
});

describe("worker-local governance RPC deadlines", () => {
  it("aborts a stalled upstream response and lets the next request recover", async () => {
    let requests = 0;
    let aborted = false;
    const url = await upstream((_req, res) => {
      requests += 1;
      if (requests === 1) {
        res.on("close", () => { aborted = true; });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"jsonrpc":"2.0","id":1,"result":');
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "recovered" }));
    });
    const proxy = await startGovernanceRpcProxy({ upstream: url,
      requestTimeoutMs: 100, lifetimeMs: 5000, allowLoopbackUpstream: true });
    resources = [...resources, proxy];
    const first = await call(proxy.endpoint);
    expect(first.status).toBe(504);
    expect((await first.json()).error.message).toBe("Governance RPC request timed out.");
    await expect.poll(() => aborted).toBe(true);
    const second = await call(proxy.endpoint);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ jsonrpc: "2.0", id: 1, result: "recovered" });
  });

  it("aborts active requests at the worker deadline and refuses later forwarding", async () => {
    let requests = 0;
    let aborted = false;
    const url = await upstream((_req, res) => {
      requests += 1;
      res.on("close", () => { aborted = true; });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"jsonrpc":"2.0","id":1,"result":');
    });
    const proxy = await startGovernanceRpcProxy({ upstream: url,
      requestTimeoutMs: 1000, lifetimeMs: 100, allowLoopbackUpstream: true });
    resources = [...resources, proxy];
    expect((await call(proxy.endpoint)).status).toBe(503);
    await expect.poll(() => aborted).toBe(true);
    expect((await call(proxy.endpoint)).status).toBe(503);
    expect(requests).toBe(1);
  });

  it("refuses redirect responses without sending a request to another destination", async () => {
    let redirected = 0;
    const destination = await upstream((_req, res) => { redirected += 1; res.end("unexpected"); });
    const url = await upstream((_req, res) => { res.writeHead(302, { Location: destination }); res.end(); });
    const proxy = await startGovernanceRpcProxy({ upstream: url, allowLoopbackUpstream: true });
    resources = [...resources, proxy];
    const response = await call(proxy.endpoint);
    expect(response.status).toBe(503);
    expect(redirected).toBe(0);
    expect((await response.json()).error.message).toBe("Governance RPC unavailable.");
  });

  it("bounds request bytes before any upstream submission", async () => {
    let forwarded = 0;
    const url = await upstream((_req, res) => { forwarded += 1; res.end("unexpected"); });
    const proxy = await startGovernanceRpcProxy({ upstream: url, maxBytes: 80, allowLoopbackUpstream: true });
    resources = [...resources, proxy];
    const response = await call(proxy.endpoint, { jsonrpc: "2.0", id: 1, method: "gen_call", params: ["x".repeat(200)] });
    expect(response.status).toBe(413);
    expect(forwarded).toBe(0);
  });

  it("bounds response bytes and returns a safe RPC error", async () => {
    const url = await upstream((_req, res) => {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "x".repeat(200) }));
    });
    const proxy = await startGovernanceRpcProxy({ upstream: url, maxBytes: 80, allowLoopbackUpstream: true });
    resources = [...resources, proxy];
    const response = await call(proxy.endpoint);
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe(-32000);
  });

  it.each([503, 429])("handles HTTP %i without returning the upstream error body", async (status) => {
    const url = await upstream((_req, res) => { res.writeHead(status); res.end("upstream private details"); });
    const proxy = await startGovernanceRpcProxy({ upstream: url, allowLoopbackUpstream: true });
    resources = [...resources, proxy];
    const response = await call(proxy.endpoint);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1,
      error: { code: -32000, message: "Governance RPC unavailable." } });
  });

  it.each(["not json", '{"jsonrpc":"2.0","id":2,"result":"wrong id"}'])
    ("fails closed on a malformed or mismatched RPC response", async (body) => {
      const url = await upstream((_req, res) => { res.end(body); });
      const proxy = await startGovernanceRpcProxy({ upstream: url, allowLoopbackUpstream: true });
      resources = [...resources, proxy];
      const response = await call(proxy.endpoint);
      expect(response.status).toBe(502);
      expect((await response.json()).error.message).toBe("Invalid governance RPC response.");
    });

  it("strips error data and explanations that might echo the signed request", async () => {
    const url = await upstream((_req, res) => {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603,
        message: "request data must not be logged", data: { sensitive: "request bytes" } } }));
    });
    const proxy = await startGovernanceRpcProxy({ upstream: url, allowLoopbackUpstream: true });
    resources = [...resources, proxy];
    expect(await (await call(proxy.endpoint)).json()).toEqual({ jsonrpc: "2.0", id: 1,
      error: { code: -32603, message: "Governance RPC operation failed." } });
  });

  it("rejects invalid input without forwarding and closes idempotently", async () => {
    let forwarded = 0;
    const url = await upstream((_req, res) => { forwarded += 1; res.end("unexpected"); });
    const proxy = await startGovernanceRpcProxy({ upstream: url, allowLoopbackUpstream: true });
    resources = [...resources, proxy];
    expect((await fetch(proxy.endpoint)).status).toBe(405);
    const invalid = await fetch(proxy.endpoint, { method: "POST", body: "invalid" });
    expect(invalid.status).toBe(400);
    expect(forwarded).toBe(0);
    await proxy.close();
    await proxy.close();
    await expect(fetch(proxy.endpoint)).rejects.toThrow();
  });

  it("requires a secure configured upstream and positive bounds", async () => {
    await expect(startGovernanceRpcProxy({ upstream: "http://example.org/api" })).rejects.toThrow("HTTPS");
    await expect(startGovernanceRpcProxy({ upstream: "https://user:password@example.org/api" })).rejects.toThrow("credentials");
    await expect(startGovernanceRpcProxy({ upstream: "https://example.org/api", requestTimeoutMs: 0 })).rejects.toThrow("positive");
  });

  it("shutdown aborts an active upstream call and closes the downstream connection", async () => {
    let started = false;
    let aborted = false;
    const url = await upstream((_req, res) => {
      started = true;
      res.on("close", () => { aborted = true; });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"jsonrpc":"2.0","id":1,"result":');
    });
    const proxy = await startGovernanceRpcProxy({ upstream: url, allowLoopbackUpstream: true });
    resources = [...resources, proxy];
    const pending = call(proxy.endpoint).then(() => "responded", () => "disconnected");
    await expect.poll(() => started).toBe(true);
    await proxy.close();
    expect(await pending).toBe("disconnected");
    await expect.poll(() => aborted).toBe(true);
  });
});
