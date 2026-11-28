import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState, DEMO_TREASURY, DEMO_OWNER } from "../../src/server/demo";
const sessionMarker = globalThis.crypto.randomUUID();
const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("../../src/server/runtime", () => ({
  getRuntime: async () => holder.runtime,
}));
import { GET } from "../../src/app/api/showcase/route";
const request = (query = "") =>
  new Request("https://agentpay.example/api/showcase" + query);
let dashboard: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const state = demoState();
  dashboard = vi.fn(async () => ({
    mode: "live",
    owner: DEMO_OWNER,
    treasury: state.treasuries[0],
    policy: state.policies[0],
    payments: [
      {
        id: "0x" + "ab".repeat(32),
        treasuryId: DEMO_TREASURY,
        agentId: state.treasuries[0].agentId,
        service: "Research API",
        amount: "4",
        recipient: state.policies[0].recipients[0],
        status: "settled",
        policyVersion: 1,
        createdAt: new Date().toISOString(),
        decisionReason: "Research service matches the mandate.",
        decisionRef: "0x" + "cd".repeat(32),
        transactionHash: "0x" + "ef".repeat(32),
        requestHash: "0x" + "12".repeat(32),
        purpose: "PRIVATE_PURPOSE",
        evidence: "PRIVATE_EVIDENCE",
        rawTransaction: "PRIVATE_SIGNED_TRANSACTION",
        idempotencyKey: "PRIVATE_KEY_REFERENCE",
      },
    ],
    credentials: [{ digest: "PRIVATE_DIGEST" }],
    sessions: [{ token: sessionMarker }],
  }));
  holder.runtime = {
    mode: "live",
    store: new MemoryStore(state),
    service: { dashboard },
  };
  vi.stubEnv("AGENTPAY_SHOWCASE_TREASURY", DEMO_TREASURY);
});
afterEach(() => vi.unstubAllEnvs());
describe("public selected showcase", () => {
  it("refreshes the specifically selected vault and returns only curated public evidence", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.mode).toBe("live");
    expect(body.data.treasuryId).toBe(DEMO_TREASURY);
    expect(body.data.payments[0].transactionHash).toBe("0x" + "ef".repeat(32));
    expect(dashboard).toHaveBeenCalledWith(DEMO_OWNER, DEMO_TREASURY);
    const encoded = JSON.stringify(body);
    for (const sensitive of [
      "PRIVATE_PURPOSE",
      "PRIVATE_EVIDENCE",
      "PRIVATE_SIGNED_TRANSACTION",
      "PRIVATE_KEY_REFERENCE",
      "PRIVATE_DIGEST",
      "Research service matches the mandate.",
      "mandate",
      "weeklyBudget",
      "totalBudget",
      "perPaymentLimit",
      "decisionReason",
      "decisionRef",
      sessionMarker,
    ])
      expect(encoded).not.toContain(sensitive);
  });
  it("ignores user-selected owner and vault parameters", async () => {
    const response = await GET(request("?owner=attacker&treasuryId=foreign"));
    expect((await response.json()).data.treasuryId).toBe(DEMO_TREASURY);
    expect(dashboard).toHaveBeenCalledWith(DEMO_OWNER, DEMO_TREASURY);
  });
  it("returns not-found when disabled, invalid, absent, or running simulation", async () => {
    for (const value of [
      "",
      "bad",
      "0x5555555555555555555555555555555555555555",
    ]) {
      vi.stubEnv("AGENTPAY_SHOWCASE_TREASURY", value);
      expect((await GET(request())).status).toBe(404);
    }
    vi.stubEnv("AGENTPAY_SHOWCASE_TREASURY", DEMO_TREASURY);
    (holder.runtime as { mode: string }).mode = "demo";
    expect((await GET(request())).status).toBe(404);
  });
  it("does not disclose a dashboard belonging to a different vault", async () => {
    dashboard.mockResolvedValueOnce({
      treasury: { id: "0x7777777777777777777777777777777777777777" },
      policy: null,
      payments: [],
    });
    expect((await GET(request())).status).toBe(404);
  });
});
