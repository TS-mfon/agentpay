import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

interface ProxyOptions {
  upstream: string;
  requestTimeoutMs?: number;
  lifetimeMs?: number;
  maxBytes?: number;
  /** Isolated tests may use an HTTP stub on loopback; deployed upstreams use HTTPS. */
  allowLoopbackUpstream?: boolean;
}
interface RpcRequest { jsonrpc: "2.0"; id: string | number | null; method: string }
class ProxyFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function settings(options: ProxyOptions) {
  const upstream = new URL(options.upstream);
  const local = options.allowLoopbackUpstream && upstream.protocol === "http:" &&
    upstream.hostname === "127.0.0.1";
  if ((!local && upstream.protocol !== "https:") || upstream.username || upstream.password)
    throw new Error("Governance RPC upstream must be HTTPS without embedded credentials.");
  const requestTimeoutMs = options.requestTimeoutMs ?? 15000;
  const lifetimeMs = options.lifetimeMs ?? 240000;
  const maxBytes = options.maxBytes ?? 1048576;
  if (![requestTimeoutMs, lifetimeMs, maxBytes].every((n) => Number.isSafeInteger(n) && n > 0))
    throw new Error("Governance RPC bounds must be positive integers.");
  return { upstream: upstream.href, requestTimeoutMs, lifetimeMs, maxBytes };
}

async function limited(stream: AsyncIterable<Uint8Array | string>, maxBytes: number, status: number) {
  let chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new ProxyFailure(status, "Governance RPC body exceeds its size limit.");
    chunks = [...chunks, bytes];
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function* responseChunks(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally { reader.releaseLock(); }
}

function requestRecord(text: string): RpcRequest {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ProxyFailure(400, "Invalid governance RPC request."); }
  if (!object(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(value.method) ||
    !(value.id === null || typeof value.id === "string" || typeof value.id === "number"))
    throw new ProxyFailure(400, "Invalid governance RPC request.");
  return value as unknown as RpcRequest;
}

function responseRecord(text: string, id: RpcRequest["id"]) {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ProxyFailure(502, "Invalid governance RPC response."); }
  if (!object(value) || value.jsonrpc !== "2.0" || value.id !== id ||
    Object.hasOwn(value, "result") === Object.hasOwn(value, "error"))
    throw new ProxyFailure(502, "Invalid governance RPC response.");
  if (Object.hasOwn(value, "error")) {
    const code = object(value.error) && Number.isSafeInteger(value.error.code) ? value.error.code : -32000;
    return { jsonrpc: "2.0", id, error: { code, message: "Governance RPC operation failed." } };
  }
  return { jsonrpc: "2.0", id, result: value.result };
}

function reply(res: ServerResponse, status: number, body: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
    ...(status === 200 ? {} : { Connection: "close" }) });
  res.end(JSON.stringify(body));
}

/** Exists only inside a worker process. It cancels network I/O; it cannot undo accepted chain writes. */
export async function startGovernanceRpcProxy(options: ProxyOptions) {
  const config = settings(options);
  const deadline = new AbortController();
  const lifetime = setTimeout(() => deadline.abort(), config.lifetimeMs);
  const expiresAt = Date.now() + config.lifetimeMs;
  let active: AbortController[] = [];
  let closed = false;
  let closing: Promise<void> | undefined;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, deadline.signal]);
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    active = [...active, controller];
    const disconnect = () => controller.abort();
    res.once("close", disconnect);
    let id: RpcRequest["id"] = null;
    try {
      if (closed || Date.now() >= expiresAt || deadline.signal.aborted)
        throw new ProxyFailure(503, "Governance RPC worker deadline reached.");
      if (req.method !== "POST" || req.url !== "/")
        throw new ProxyFailure(405, "Only governance RPC POST requests are supported.");
      const cancelInput = () => req.destroy();
      signal.addEventListener("abort", cancelInput, { once: true });
      let body: string;
      try { body = await limited(req.iterator({ destroyOnReturn: false }), config.maxBytes, 413); }
      finally { signal.removeEventListener("abort", cancelInput); }
      id = requestRecord(body).id;
      const response = await fetch(config.upstream, { method: "POST",
        headers: { "Content-Type": "application/json" }, body, redirect: "error", signal });
      if (!response.ok) throw new ProxyFailure(response.status === 429 ? 429 : 503,
        "Governance RPC unavailable.");
      if (!response.body) throw new ProxyFailure(502, "Invalid governance RPC response.");
      const text = await limited(responseChunks(response.body), config.maxBytes, 502);
      reply(res, 200, responseRecord(text, id));
    } catch (error) {
      const failure = error instanceof ProxyFailure ? error : signal.aborted
        ? new ProxyFailure(deadline.signal.aborted ? 503 : 504, deadline.signal.aborted
          ? "Governance RPC worker deadline reached." : "Governance RPC request timed out.")
        : new ProxyFailure(503, "Governance RPC unavailable.");
      reply(res, failure.status, { jsonrpc: "2.0", id,
        error: { code: -32000, message: failure.message } });
    } finally {
      controller.abort();
      clearTimeout(timer);
      res.removeListener("close", disconnect);
      active = active.filter((item) => item !== controller);
    }
  }

  const server = createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.min(config.requestTimeoutMs, 5000);
  server.keepAliveTimeout = 1000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
  } catch (error) { clearTimeout(lifetime); throw error; }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Governance RPC proxy has no listening port.");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      clearTimeout(lifetime);
      deadline.abort();
      active.forEach((controller) => controller.abort());
      closing = new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
