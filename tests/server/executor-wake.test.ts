import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Payment } from "../../src/core/types";
import { emptyState } from "../../src/core/types";
import { MemoryStore } from "../../src/server/memory-store";

const next = vi.hoisted(() => ({
  tasks: [] as Array<() => Promise<void>>,
  runtime: vi.fn(),
}));

vi.mock("next/server", async (loadOriginal) => ({
  ...await loadOriginal<typeof import("next/server")>(),
  after: (task: () => Promise<void>) => next.tasks.push(task),
}));
vi.mock("../../src/server/runtime", () => ({ getRuntime: next.runtime }));
import { POST } from "../../src/app/api/executor/wake/route";
import { POST as createOwnerPayment } from "../../src/app/api/owner/payments/route";
import { POST as createAgentPayment } from "../../src/app/api/v1/payments/route";

const origin = "https://agentpay.example";
const start = 1900000000000;
const github = vi.fn<typeof fetch>();
const duePayment: Payment = {
  id: "0x" + "a".repeat(64), treasuryId: "0x" + "1".repeat(40), agentId: "0x" + "b".repeat(64), policyVersion: 1,
  mandateHash: "0x" + "c".repeat(64), requestHash: "0x" + "d".repeat(64), amount: "0.001", amountUnits: "1000",
  recipient: "0x" + "2".repeat(40), service: "Test", purpose: "Nominal integration test.",
  evidence: "", idempotencyKey: "fixture-purchase",
  createdAt: new Date(start - 1000).toISOString(), expiresAt: new Date(start + 3600000).toISOString(),
  status: "queued", attempts: 0,
};

function visit(from = origin, options: RequestInit = {}) {
  return POST(new Request(origin + "/api/executor/wake", {
    method: "POST",
    headers: { Origin: from, "Sec-Fetch-Site": "same-origin" },
    ...options,
  }));
}

async function runVisit() {
  expect((await visit()).status).toBe(204);
  const task = next.tasks.shift();
  if (task) await task();
}

let store: MemoryStore;
beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("AGENTPAY_MODE", "live");
  vi.stubEnv("GITHUB_REPOSITORY", "TS-mfon/agentpay");
  vi.stubEnv("GITHUB_DISPATCH_TOKEN", "fixture-dispatch-credential");
  vi.spyOn(Date, "now").mockReturnValue(start);
  next.tasks.length = 0;
  next.runtime.mockReset();
  store = new MemoryStore({ ...emptyState(), payments: [duePayment] });
  next.runtime.mockResolvedValue({ mode: "live", store });
  github.mockReset().mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", github);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("executor dispatch after a site visit", () => {
  it("returns before calling GitHub and dispatches the named workflow once across concurrent visits", async () => {
    const anotherInstance = { read: () => store.read(), update: store.update.bind(store) };
    next.runtime.mockResolvedValueOnce({ mode: "live", store: anotherInstance });
    const responses = await Promise.all([visit(), visit()]);
    expect(responses.map(response => response.status)).toEqual([204, 204]);
    expect(responses[0].headers.get("cache-control")).toBe("no-store");
    expect(github).not.toHaveBeenCalled();
    await Promise.all(next.tasks.map(task => task()));
    expect(github).toHaveBeenCalledTimes(1);
    expect((await store.read()).revision).toBe(1);
    const [url, init] = github.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/TS-mfon/agentpay/actions/workflows/executor.yml/dispatches");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-dispatch-credential");
    expect(JSON.parse(String(init?.body))).toEqual({ ref: "main", inputs: { batch: "20" } });
  });

  it("skips an idle queue, work in backoff and work claimed by an active executor", async () => {
    await store.update(state => ({ ...state, payments: [{ ...duePayment, status: "settled" }] }));
    await runVisit();
    vi.mocked(Date.now).mockReturnValue(start + 10000);
    await store.update(state => ({ ...state, payments: [{ ...duePayment, retryAt: start + 30000 }] }));
    await runVisit();
    vi.mocked(Date.now).mockReturnValue(start + 20000);
    await store.update(state => ({ ...state, payments: [duePayment], workerLease: { token: "runner", expiresAt: start + 30000 } }));
    await runVisit();
    expect(github).not.toHaveBeenCalled();
    expect((await store.read()).revision).toBe(3);
  });

  it("wakes the worker to expire overdue requests even if their next retry is in the future", async () => {
    await store.update(state => ({ ...state, payments: [{
      ...duePayment, expiresAt: new Date(start - 1).toISOString(), retryAt: start + 5000,
    }] }));
    await runVisit();
    expect(github).toHaveBeenCalledOnce();
    expect((await store.read()).payments[0].status).toBe("queued");
  });

  it("leaves a lost dispatch response throttled and tries again on a later visit", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    github.mockRejectedValueOnce(new DOMException("Private provider detail", "TimeoutError"));
    await runVisit();
    vi.mocked(Date.now).mockReturnValue(start + 10000);
    await runVisit();
    expect(github).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("Private provider detail");
    vi.mocked(Date.now).mockReturnValue(start + 120000);
    await runVisit();
    expect(github).toHaveBeenCalledTimes(2);
  });

  it("limits database reads from repeated visits even when the queue is empty", async () => {
    await store.update(state => ({ ...state, payments: [] }));
    const read = vi.spyOn(store, "read");
    await runVisit();
    await runVisit();
    expect(read).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue(start + 10000);
    await runVisit();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["/api/owner/payments", createOwnerPayment, { Cookie: "agentpay_session=fixture-session" }],
    ["/api/v1/payments", createAgentPayment, { Authorization: "Bearer fixture-agent" }],
  ] as const)("wakes immediately after an accepted payment on %s following an idle visit", async (path, handler, proof) => {
    await store.update(state => ({ ...state, payments: [] }));
    const requestPayment = vi.fn(async () => {
      await store.update(state => ({ ...state, payments: [duePayment] }));
      return duePayment;
    });
    next.runtime.mockResolvedValue({
      mode: "live",
      store,
      auth: { identity: vi.fn(async () => ({ owner: "owner" })) },
      service: { requestPayment, authenticateAgent: vi.fn(async () => ({ owner: "owner", treasuryId: "vault" })) },
    });
    await runVisit();
    expect(github).not.toHaveBeenCalled();

    const response = await handler(new Request(origin + path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...proof },
      body: "{}",
    }));
    expect(response.status).toBe(200);
    expect(github).not.toHaveBeenCalled();
    expect(next.tasks).toHaveLength(1);
    await next.tasks[0]();
    expect(github).toHaveBeenCalledTimes(1);
  });

  it("does not accept a cross-origin or data-bearing visit", async () => {
    expect((await visit("https://other.example")).status).toBe(403);
    expect((await visit(origin, { body: "{}" })).status).toBe(403);
    expect((await visit(origin, { headers: { Origin: origin, "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    expect(next.tasks).toHaveLength(0);
    expect(next.runtime).not.toHaveBeenCalled();
  });

  it("does no background work without a dispatch credential or in demo mode", async () => {
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "");
    await runVisit();
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "fixture-dispatch-credential");
    vi.stubEnv("AGENTPAY_MODE", "demo");
    await runVisit();
    expect(next.runtime).not.toHaveBeenCalled();
    expect(github).not.toHaveBeenCalled();
  });
});
