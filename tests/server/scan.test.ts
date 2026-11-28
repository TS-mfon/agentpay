import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoPorts, demoState, DEMO_OWNER, DEMO_RECIPIENT } from "../../src/server/demo";
import { MemoryStore } from "../../src/server/memory-store";
import { AgentPayService } from "../../src/core/service";
import { AppError } from "../../src/core/errors";
import type { Payment } from "../../src/core/types";

const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("../../src/server/runtime", () => ({
  getRuntime: async () => holder.runtime,
}));

import { GET as list } from "../../src/app/api/scan/payments/route";
import { GET as detail } from "../../src/app/api/scan/payments/[id]/route";

const reference = (character: string) => "0x" + character.repeat(64);
const newerId = reference("a");
const olderId = reference("b");
const tiedId = reference("c");
const receipt = reference("f");
const origin = "https://scan.agentpay.example";
const feed = (query = "") => list(new Request(origin + "/api/scan/payments" + query));
const lookup = (id: string) => detail(new Request(origin + "/api/scan/payments/" + id), {
  params: Promise.resolve({ id }),
});
const clock = Date.parse("2026-11-25T12:00:00.000Z");
const treasury = demoState(clock).treasuries[0];

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: newerId,
    createdAt: "2026-11-25T11:00:00.000Z",
    expiresAt: "2026-11-25T12:10:00.000Z",
    treasuryId: treasury.id,
    agentId: treasury.agentId,
    recipient: DEMO_RECIPIENT,
    amount: "0.000001",
    amountUnits: "1",
    status: "queued",
    attempts: 1,
    policyVersion: 1,
    mandateHash: reference("1"),
    requestHash: reference("2"),
    service: "PRIVATE_SERVICE",
    purpose: "PRIVATE_PURPOSE",
    evidence: "PRIVATE_EVIDENCE",
    idempotencyKey: "PRIVATE_IDEMPOTENCY_KEY",
    decisionReason: "PRIVATE_REASON",
    error: "PRIVATE_ERROR",
    rawTransaction: "PRIVATE_TRANSACTION",
    rawGovernanceTransaction: "PRIVATE_GOVERNANCE_TRANSACTION",
    ...overrides,
  };
}

let store: MemoryStore;
let service: AgentPayService;

beforeEach(() => {
  vi.stubEnv("AGENTPAY_SCAN_FEED", "");
  store = new MemoryStore({ ...demoState(clock), payments: [payment()] });
  service = new AgentPayService(store, demoPorts(), "live");
  holder.runtime = { mode: "live", store, service };
});

afterEach(() => vi.unstubAllEnvs());

describe("Scan payment feed", () => {
  it("returns exact amounts and only the approved public fields in newest-first order", async () => {
    await store.update(state => ({
      ...state,
      payments: [
        payment({ id: olderId, createdAt: "2026-11-25T10:00:00.000Z", status: "settled", transactionHash: receipt }),
        payment(),
      ],
    }));
    const response = await feed();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      success: true,
      data: {
        nextCursor: null,
        items: [
          { id: newerId, agentName: "Research scout", amount: "0.000001", status: "queued", createdAt: "2026-11-25T11:00:00.000Z" },
          { id: olderId, agentName: "Research scout", amount: "0.000001", status: "settled", createdAt: "2026-11-25T10:00:00.000Z" },
        ],
      },
    });
  });
});

describe("Scan pagination and access", () => {
  it("pages through timestamp ties once when a newer request is submitted", async () => {
    await store.update(state => ({
      ...state,
      payments: [payment({ id: tiedId }), payment({
        id: olderId, createdAt: "2026-11-25T10:00:00.000Z",
      }), payment()],
    }));
    const first = (await (await feed("?limit=1")).json()).data;
    expect(first.items.map((row: Payment) => row.id)).toEqual([newerId]);
    expect(first.nextCursor).toEqual(expect.any(String));

    await store.update(state => ({
      ...state,
      payments: [...state.payments, payment({
        id: reference("d"), createdAt: "2026-11-25T11:01:00.000Z",
      })],
    }));
    const second = (await (await feed("?limit=2&cursor=" + first.nextCursor)).json()).data;
    expect(second.items.map((row: Payment) => row.id)).toEqual([tiedId, olderId]);
    expect(second.nextCursor).toBeNull();
  });

  it("groups lifecycle statuses and refreshes specific IDs without a page cursor", async () => {
    await store.update(state => ({
      ...state,
      payments: [payment(), payment({ id: olderId, status: "awaiting_finality" }),
        payment({ id: tiedId, status: "executing" })],
    }));
    const pending = (await (await feed("?status=pending")).json()).data;
    const approved = (await (await feed("?status=approved")).json()).data;
    const refresh = (await (await feed("?ids=" + tiedId + "," + newerId.toUpperCase() + "," + reference("d"))).json()).data;
    expect(pending.items.map((row: Payment) => row.id)).toEqual([newerId, olderId]);
    expect(approved.items.map((row: Payment) => row.id)).toEqual([tiedId]);
    expect(refresh.items.map((row: Payment) => row.id)).toEqual([newerId, tiedId]);
    expect(refresh.nextCursor).toBeNull();
  });

  it("rejects invalid, ambiguous, or oversized queries and malformed lookup IDs", async () => {
    const oversized = Array.from({ length: 25 }, () => newerId).join(",");
    for (const query of [
      "?status=__proto__", "?status=settled&status=rejected", "?limit=0", "?limit=25",
      "?cursor=invalid", "?cursor=", "?ids=", "?ids=bad", "?status=settled&ids=" + newerId,
      "?ids=" + oversized, "?treasuryId=anything",
    ]) {
      const response = await feed(query);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_SCAN_QUERY");
    }
    expect((await lookup("0x123")).status).toBe(400);
    expect((await lookup(reference("d"))).status).toBe(404);
  });

  it("can disable both feed forms while direct ID lookup stays public", async () => {
    vi.stubEnv("AGENTPAY_SCAN_FEED", "false");
    for (const query of ["", "?ids=" + newerId]) {
      const response = await feed(query);
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("SCAN_FEED_DISABLED");
    }
    const response = await lookup(newerId.toUpperCase());
    expect(response.status).toBe(200);
    expect((await response.json()).data.id).toBe(newerId);
  });
});

describe("Scan payment detail", () => {
  it("shows a legacy verdict without returning the stored reason or request data", async () => {
    await store.update(state => ({
      ...state,
      payments: [payment({ status: "rejected", decisionRef: reference("3") })],
    }));
    const response = await lookup(newerId);
    expect(await response.json()).toEqual({
      success: true,
      data: { id: newerId, agentName: "Research scout", amount: "0.000001",
        createdAt: "2026-11-25T11:00:00.000Z", status: "rejected",
        governance: { verdict: "rejected" } },
    });
  });

  it("derives a bounded public explanation when the worker records a new verdict", async () => {
    service = new AgentPayService(store, { ...demoPorts(), now: () => clock }, "demo");
    holder.runtime = { mode: "demo", store, service };
    const request = await service.requestPayment(DEMO_OWNER, {
      recipient: DEMO_RECIPIENT, amount: "4", service: "Research API",
      purpose: "Purchase a dataset for private work", evidence: "", idempotencyKey: "new-request-1",
    }, treasury.id);
    await service.processBatch();
    const { data } = await (await lookup(request.id)).json();
    expect(data.governance).toEqual({
      verdict: "needs_information",
      explanation: "More supporting evidence is needed before this request can be approved.",
    });
    const owner = await service.getPayment(DEMO_OWNER, request.id, treasury.id);
    expect(owner.decisionReason).toBe("Simulation: provide invoice details or supporting evidence.");
    expect(data).not.toHaveProperty("decisionReason");
  });

  it("uses known stored settlement proof and checks legacy transfers only on detail", async () => {
    const port = vi.spyOn(service.ports.settlement, "reconcile");
    port.mockResolvedValue({ status: "settled", transactionHash: receipt });
    await store.update(state => ({
      ...state,
      payments: [payment({ status: "settled", transactionHash: receipt }),
        payment({ id: olderId, status: "settled", transactionHash: receipt,
          scan: { verifiedSettlementHash: receipt } })],
    }));
    await feed();
    expect(port).not.toHaveBeenCalled();
    const proven = (await (await lookup(olderId)).json()).data;
    expect(proven.transactionHash).toBe(receipt);
    expect(port).not.toHaveBeenCalled();
    const legacy = (await (await lookup(newerId)).json()).data;
    expect(legacy.transactionHash).toBe(receipt);
    expect((await (await lookup(newerId)).json()).data.transactionHash).toBe(receipt);
    expect(port).toHaveBeenCalledTimes(1);
  });

  it("omits unproved, nonsettled, and simulated transfer references", async () => {
    const port = vi.spyOn(service.ports.settlement, "reconcile");
    port.mockResolvedValue({ status: "verification_failed", transactionHash: receipt });
    await store.update(state => ({
      ...state,
      payments: [payment({ status: "settled", transactionHash: receipt }),
        payment({ id: olderId, status: "approved", transactionHash: receipt }),
        payment({ id: tiedId, status: "settled", transactionHash: "javascript:alert(1)" })],
    }));
    for (const id of [newerId, olderId, tiedId])
      expect((await (await lookup(id)).json()).data).not.toHaveProperty("transactionHash");
    expect(port).toHaveBeenCalledTimes(1);
    holder.runtime = { mode: "demo", store, service };
    expect((await (await lookup(newerId)).json()).data).not.toHaveProperty("transactionHash");
    expect(port).toHaveBeenCalledTimes(1);
  });

  it("publishes expiration and a failed phase without disclosing internal errors", async () => {
    await store.update(state => ({
      ...state,
      payments: [payment({ status: "expired" }),
        payment({ id: olderId, status: "failed", transactionHash: receipt })],
    }));
    const expired = (await (await lookup(newerId)).json()).data;
    expect(expired).toMatchObject({ status: "expired", expiresAt: "2026-11-25T12:10:00.000Z" });
    const failed = (await (await lookup(olderId)).json()).data;
    expect(failed).toMatchObject({ status: "failed", failureStage: "settlement" });
    for (const row of [failed, expired])
      expect(row).not.toHaveProperty("error");
  });

  it("records the phase of a new failure even when no governance reference was written", async () => {
    const ports = { ...demoPorts(), now: () => clock };
    vi.spyOn(ports.governance, "register").mockRejectedValue(new AppError("POLICY_REGISTRATION_FAILED", "PRIVATE_FAILURE"));
    service = new AgentPayService(store, ports, "demo");
    holder.runtime = { mode: "demo", store, service };
    const request = await service.requestPayment(DEMO_OWNER, {
      recipient: DEMO_RECIPIENT, amount: "4", service: "Research API",
      purpose: "Purchase a dataset for private work", evidence: "", idempotencyKey: "failed-request-1",
    }, treasury.id);
    await service.processBatch();
    const { data } = await (await lookup(request.id)).json();
    expect(data).toMatchObject({ status: "failed", failureStage: "governance" });
    expect(JSON.stringify(data)).not.toContain("PRIVATE_FAILURE");
  });
});

describe("Scan verification and read limits", () => {
  it("retains proof from a fresh settlement without verifying again on a public read", async () => {
    const seed = demoState(clock);
    const policy = seed.policies[0];
    store = new MemoryStore({ ...seed, payments: [payment({
      status: "approved", mandateHash: policy.mandateHash, decisionRef: reference("3"),
      approvalExpiresAt: Math.floor(clock / 1000) + 600,
    })] });
    const ports = { ...demoPorts(), now: () => clock };
    vi.spyOn(ports.settlement, "snapshot").mockResolvedValue({
      ...treasury,
      mandateHash: policy.mandateHash,
      perPaymentLimit: policy.perPaymentLimit,
      weeklyBudget: policy.weeklyBudget,
      totalBudget: policy.totalBudget,
      validUntil: policy.validUntil,
      recipients: policy.recipients,
    });
    vi.spyOn(ports.settlement, "prepare").mockResolvedValue({ hash: receipt, rawTransaction: "test-transaction" });
    const reconcile = vi.spyOn(ports.settlement, "reconcile").mockResolvedValue({ status: "settled", transactionHash: receipt });
    service = new AgentPayService(store, ports, "live");
    holder.runtime = { mode: "live", store, service };
    await service.processBatch(1);

    const response = await lookup(newerId);
    expect((await response.json()).data).toMatchObject({ status: "settled", transactionHash: receipt });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(await service.getPayment(DEMO_OWNER, newerId, treasury.id)).not.toHaveProperty("scan");
  });

  it("returns detail after a bounded receipt wait and shares the ongoing check", async () => {
    vi.useFakeTimers();
    try {
      const pending = Promise.withResolvers<{ status: "settled"; transactionHash: string }>();
      const port = vi.spyOn(service.ports.settlement, "reconcile").mockReturnValue(pending.promise);
      await store.update(state => ({ ...state, payments: [payment({ status: "settled", transactionHash: receipt })] }));

      const first = lookup(newerId);
      await vi.advanceTimersByTimeAsync(4_000);
      expect((await (await first).json()).data).not.toHaveProperty("transactionHash");

      pending.resolve({ status: "settled", transactionHash: receipt });
      expect((await (await lookup(newerId)).json()).data.transactionHash).toBe(receipt);
      expect(port).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps detail available when legacy verification fails to reach the network", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      vi.spyOn(service.ports.settlement, "reconcile").mockRejectedValue(new Error("PRIVATE_RPC_ENDPOINT"));
      await store.update(state => ({ ...state, payments: [payment({ status: "settled", transactionHash: receipt })] }));
      const response = await lookup(newerId);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).not.toHaveProperty("transactionHash");
      expect(JSON.stringify(body)).not.toContain("PRIVATE_RPC_ENDPOINT");
    } finally {
      warning.mockRestore();
    }
  });

  it("limits a burst of public polls without updating the durable snapshot", async () => {
    const revision = (await store.read()).revision;
    const request = () => new Request(origin + "/api/scan/payments?ids=" + newerId, {
      headers: { "x-forwarded-for": "192.0.2.25" },
    });
    vi.useFakeTimers();
    try {
      const responses = await Promise.all(Array.from({ length: 90 }, () => list(request())));
      expect(responses.every(response => response.status === 200)).toBe(true);
      const blocked = await list(request());
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("60");
      expect((await store.read()).revision).toBe(revision);
    } finally {
      vi.useRealTimers();
    }
  });
});
