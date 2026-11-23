import { paymentSchema } from "../src/core/validation";

export class AgentPayClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AgentPayClientError";
  }
}
interface ClientOptions { fetch?: typeof globalThis.fetch; now?: () => number }
const MAX_RESPONSE_BYTES = 1_500_000;
const REQUEST_ID = /^0x[0-9a-fA-F]{64}$/;

function validateOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AgentPayClientError("CONFIGURATION_REQUIRED", "Set AGENTPAY_BASE_URL to the app's HTTPS origin."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new AgentPayClientError("CONFIGURATION_REQUIRED", "Use an HTTPS origin without credentials, a path, or query parameters. Local development may use loopback HTTP.");
  }
  return url.origin;
}
async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AgentPayClientError("INVALID_RESPONSE", "AgentPay returned an invalid response.");
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AgentPayClientError("RESPONSE_TOO_LARGE", "AgentPay response exceeds the local size limit.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof AgentPayClientError) throw error;
    throw new AgentPayClientError("INVALID_RESPONSE", "AgentPay returned an invalid response.");
  } finally { reader.releaseLock(); }
}
function failure(response: Response, payload: unknown): AgentPayClientError {
  const candidate = payload && typeof payload === "object" && "error" in payload ? (payload as {error?: {code?: unknown}}).error?.code : undefined;
  const code = typeof candidate === "string" && /^[A-Z_]{2,60}$/.test(candidate) ? candidate : "REQUEST_FAILED";
  const messages: Record<number, string> = {
    401: "Agent credential is invalid, expired, or revoked.",
    403: "The agent does not have authority for this action.",
    404: "The requested payment or treasury was not found.",
    409: "Request conflicts with existing state. Check the policy and original request before retrying.",
    429: "AgentPay rate limit reached. Wait before retrying.",
    503: "AgentPay is temporarily unavailable. Retrieve payment status before retrying a submission.",
  };
  return new AgentPayClientError(code, messages[response.status] ?? "AgentPay rejected the request. Check its fields, mandate, limits, approved recipients, and available balance.");
}
export class AgentPayClient {
  private readonly origin: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => number;
  private calls: readonly number[] = [];
  constructor(baseUrl: string, private readonly apiKey: string, options: ClientOptions = {}) {
    this.origin = validateOrigin(baseUrl);
    if (!/^ap_[A-Za-z0-9_-]{43}$/.test(apiKey)) throw new AgentPayClientError("CONFIGURATION_REQUIRED", "Set AGENTPAY_API_KEY to an agent-scoped credential issued by the owner.");
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }
  private async call(path: string, body?: unknown): Promise<unknown> {
    const now = this.now();
    const recent = this.calls.filter(time => time > now - 60_000);
    if (recent.length >= 60) throw new AgentPayClientError("RATE_LIMITED", "Too many local tool calls. Wait a minute before retrying.");
    this.calls = [...recent, now];
    let response: Response;
    try {
      response = await this.fetcher(this.origin + path, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AgentPayClientError("NETWORK_UNAVAILABLE", "AgentPay could not be reached. Retrieve payment status before retrying a submission.");
    }
    const payload = await boundedJson(response);
    if (!response.ok) throw failure(response, payload);
    if (!payload || typeof payload !== "object" || !("success" in payload) || payload.success !== true || !("data" in payload)) {
      throw new AgentPayClientError("INVALID_RESPONSE", "AgentPay returned an invalid response.");
    }
    return payload.data;
  }
  treasury() { return this.call("/api/v1/treasury"); }
  policy() { return this.call("/api/v1/policy"); }
  payment(id: string) {
    if (!REQUEST_ID.test(id)) return Promise.reject(new AgentPayClientError("INVALID_REQUEST", "Use the 32-byte hexadecimal payment request ID."));
    return this.call("/api/v1/payments/" + id);
  }
  async requestPayment(input: unknown) {
    const result = paymentSchema.safeParse(input);
    if (!result.success) throw new AgentPayClientError("INVALID_REQUEST", "Use a valid recipient, positive decimal amount, purpose, and 8-100 character idempotency key.");
    return this.call("/api/v1/payments", result.data);
  }
  async history(limit = 20): Promise<unknown[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AgentPayClientError("INVALID_REQUEST", "History limit must be between 1 and 100.");
    const data = await this.call("/api/v1/payments");
    if (!Array.isArray(data)) throw new AgentPayClientError("INVALID_RESPONSE", "AgentPay returned an invalid response.");
    return data.slice(0, limit);
  }
}
