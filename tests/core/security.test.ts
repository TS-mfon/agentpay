import { describe, it, expect, vi } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import {
  demoState,
  demoPorts,
  DEMO_OWNER as owner,
  DEMO_RECIPIENT as recipient,
} from "../../src/server/demo";
import { hashText } from "../../src/core/validation";
import type { Ports, VaultSnapshot } from "../../src/core/ports";
import type { State } from "../../src/core/types";
const now = 1800000000000;
const input = {
  recipient,
  amount: "4",
  service: "Research API",
  purpose: "Market research dataset",
  evidence: "Verified company dataset invoice",
  idempotencyKey: "safety-0001",
};
function create(
  state = demoState(now),
  overrides: Partial<Ports> = {},
  mode: "demo" | "live" = "demo",
) {
  let time = now;
  const store = new MemoryStore(state);
  const ports = { ...demoPorts(), ...overrides, now: () => time };
  return {
    store,
    ports,
    service: new AgentPayService(store, ports, mode),
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const mutate = (state: State, patch: Partial<State["treasuries"][number]>) => ({
  ...state,
  treasuries: state.treasuries.map((t) => ({ ...t, ...patch })),
});
const policyInput = () => ({
  mandate: "Research services only. Entertainment prohibited.",
  perPaymentLimit: "10",
  weeklyBudget: "40",
  totalBudget: "100",
  validUntil: Math.floor(now / 1000) + 100000,
  recipients: [recipient],
});
function snapshot(state = demoState(now)): VaultSnapshot {
  const t = state.treasuries[0],
    p = state.policies[0];
  return { ...t, ...p, policyVersion: p.version };
}

describe("validation and financial authority", () => {
  it.each([
    "0",
    "-1",
    "1.0000001",
    "1e3",
    "NaN",
    "01",
    "999999999999999999999",
  ])("rejects malformed amount %s", async (amount) => {
    const { service } = create();
    await expect(
      service.requestPayment(owner, { ...input, amount }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it.each(["paused", "revoked", "expired", "recipient"])(
    "blocks %s authority before evaluation",
    async (scenario) => {
      let state = demoState(now);
      if (scenario === "paused") state = mutate(state, { paused: true });
      if (scenario === "revoked") state = mutate(state, { active: false });
      if (scenario === "expired")
        state = {
          ...state,
          policies: state.policies.map((p) => ({
            ...p,
            validUntil: Math.floor(now / 1000) - 1,
          })),
        };
      const { service } = create(state);
      await expect(
        service.requestPayment(owner, {
          ...input,
          recipient:
            scenario === "recipient"
              ? "0x5555555555555555555555555555555555555555"
              : recipient,
        }),
      ).rejects.toBeDefined();
    },
  );
  it("reserves pending requests against weekly funds across concurrent requests", async () => {
    const state = {
      ...demoState(now),
      policies: demoState(now).policies.map((p) => ({
        ...p,
        weeklyBudget: "6",
      })),
    };
    const { service } = create(state);
    await service.requestPayment(owner, input);
    await expect(
      service.requestPayment(owner, {
        ...input,
        idempotencyKey: "safety-0002",
      }),
    ).rejects.toMatchObject({ code: "WEEKLY_BUDGET" });
  });
  it("enforces cumulative budget and balance", async () => {
    let { service } = create(mutate(demoState(now), { totalSpent: "98" }));
    await expect(service.requestPayment(owner, input)).rejects.toMatchObject({
      code: "TOTAL_BUDGET",
    });
    ({ service } = create(mutate(demoState(now), { balance: "2" })));
    await expect(service.requestPayment(owner, input)).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
  });
  it("recognizes a new week without erasing cumulative spend", async () => {
    const { service } = create(
      mutate(demoState(now), {
        weeklySpent: "40",
        week: Math.floor(now / 604800000) - 1,
        totalSpent: "10",
      }),
    );
    await service.requestPayment(owner, input);
    await service.processBatch(10);
    const dashboard = await service.dashboard(owner);
    expect(dashboard.treasury?.weeklySpent).toBe("4");
    expect(dashboard.treasury?.totalSpent).toBe("14");
  });
  it("returns not-found for a different owner and absent request", async () => {
    const { service } = create();
    await expect(
      service.getPayment(
        "0x5555555555555555555555555555555555555555",
        "missing",
      ),
    ).rejects.toMatchObject({ code: "TREASURY_NOT_FOUND" });
    await expect(service.getPayment(owner, "missing")).rejects.toMatchObject({
      code: "PAYMENT_NOT_FOUND",
    });
  });
  it("bounds stored requests rather than silently dropping history", async () => {
    const { service, store } = create();
    const request = await service.requestPayment(owner, input);
    await store.update((s) => ({
      ...s,
      payments: Array.from({ length: 1000 }, (_, i) => ({
        ...request,
        id: hashText(String(i)),
        status: "rejected" as const,
      })),
    }));
    await expect(
      service.requestPayment(owner, {
        ...input,
        idempotencyKey: "capacity-0001",
      }),
    ).rejects.toMatchObject({ code: "REQUEST_CAPACITY" });
  });
});

describe("policy and owner controls", () => {
  it("preserves old mandate snapshots and expires pending approval on policy change", async () => {
    const { service, store } = create();
    const request = await service.requestPayment(owner, input);
    await service.updatePolicy(owner, policyInput());
    const state = await store.read();
    expect(state.policies).toHaveLength(2);
    expect(state.policies[0].mandate).toContain("market research");
    expect((await service.getPayment(owner, request.id)).status).toBe(
      "expired",
    );
  });
  it("never resets settled budgets when a policy changes", async () => {
    const { service } = create(
      mutate(demoState(now), { weeklySpent: "8", totalSpent: "25" }),
    );
    await service.updatePolicy(owner, policyInput());
    const { treasury } = await service.dashboard(owner);
    expect(treasury?.weeklySpent).toBe("8");
    expect(treasury?.totalSpent).toBe("25");
  });
  it("supports owner withdrawal while paused and stops old requests after resume", async () => {
    const { service } = create();
    const request = await service.requestPayment(owner, input);
    await service.control(owner, { action: "pause" });
    await service.control(owner, { action: "withdraw", amount: "10" });
    await service.control(owner, { action: "resume" });
    const dashboard = await service.dashboard(owner);
    expect(dashboard.treasury?.balance).toBe("90");
    expect(dashboard.treasury?.policyVersion).toBe(2);
    expect((await service.getPayment(owner, request.id)).status).toBe(
      "expired",
    );
    await service.control(owner, { action: "fund", amount: "2" });
    expect((await service.dashboard(owner)).treasury?.balance).toBe("92");
  });
  it("rejects malformed controls, zero funding, excessive withdrawal and direct reactivation", async () => {
    const { service } = create();
    for (const invalid of [
      null,
      { action: "explode" },
      { action: "fund", amount: "0" },
      { action: "withdraw", amount: "999" },
      { action: "reactivate" },
    ])
      await expect(service.control(owner, invalid)).rejects.toBeDefined();
  });
  it("revoke invalidates keys and pending requests", async () => {
    const { service } = create();
    const credential = await service.issueCredential(owner);
    expect((await service.authenticateAgent(credential.key)).owner).toBe(owner);
    const request = await service.requestPayment(owner, input);
    await service.control(owner, { action: "revoke" });
    await expect(
      service.authenticateAgent(credential.key),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await service.getPayment(owner, request.id)).status).toBe(
      "expired",
    );
    await expect(service.issueCredential(owner)).rejects.toMatchObject({
      code: "AGENT_REVOKED",
    });
  });
  it("rotates opaque credentials without retaining raw keys at rest", async () => {
    const { service, store } = create();
    const first = await service.issueCredential(owner);
    const second = await service.issueCredential(owner);
    await expect(service.authenticateAgent(first.key)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect((await service.authenticateAgent(second.key)).treasuryId).toBe(
      second.treasuryId,
    );
    expect(JSON.stringify(await store.read())).not.toContain(second.key);
    await expect(service.authenticateAgent("wrong")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("fails closed for malformed and expired mandates", async () => {
    const { service } = create();
    await expect(
      service.updatePolicy(owner, { ...policyInput(), mandate: "" }),
    ).rejects.toMatchObject({ code: "INVALID_POLICY" });
    await expect(
      service.updatePolicy(owner, { ...policyInput(), validUntil: 1 }),
    ).rejects.toMatchObject({ code: "POLICY_EXPIRED" });
  });
  it("registers a newly funded demo vault and rejects duplicate setup", async () => {
    const { service } = create({
      ...demoState(now),
      treasuries: [],
      policies: [],
    });
    const setup = {
      ...policyInput(),
      treasuryId: "0x7777777777777777777777777777777777777777",
      agentName: "New research agent",
    };
    expect((await service.dashboard(owner)).treasury).toBeNull();
    await service.setup(owner, setup);
    await service.control(owner, { action: "fund", amount: "50" });
    expect((await service.dashboard(owner)).treasury?.balance).toBe("50");
    await expect(service.setup(owner, setup)).rejects.toMatchObject({
      code: "TREASURY_EXISTS",
    });
  });
  it.each([
    null,
    { ...policyInput(), treasuryId: "bad", agentName: "Agent" },
    { ...policyInput(), treasuryId: recipient, agentName: "" },
    {
      ...policyInput(),
      treasuryId: recipient,
      agentName: "Agent",
      validUntil: 1,
    },
  ])("rejects invalid setup", async (setup) => {
    const { service } = create({
      ...demoState(now),
      treasuries: [],
      policies: [],
    });
    await expect(service.setup(owner, setup)).rejects.toBeDefined();
  });
});

describe("finality and settlement recovery", () => {
  it("does not execute accepted but unfinalized decisions", async () => {
    const demo = demoPorts();
    const prepare = vi.fn(demo.settlement.prepare);
    const { service } = create(undefined, {
      governance: {
        ...demo.governance,
        inspect: async (_ref, p) => ({
          finalized: false,
          status: "approved",
          reason: "Accepted",
          requestHash: p.requestHash,
          mandateHash: p.mandateHash,
        }),
      },
      settlement: { ...demo.settlement, prepare },
    });
    const request = await service.requestPayment(owner, input);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).status).toBe(
      "awaiting_finality",
    );
    expect(prepare).not.toHaveBeenCalled();
  });
  it("requires request and policy hashes to match the finalized verdict", async () => {
    const demo = demoPorts();
    const { service } = create(undefined, {
      governance: {
        ...demo.governance,
        inspect: async () => ({
          finalized: true,
          status: "approved",
          reason: "Approved",
          requestHash: "wrong",
          mandateHash: "wrong",
        }),
      },
    });
    const request = await service.requestPayment(owner, input);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).status).toBe("failed");
  });
  it("keeps uncertain requests unpaid and returns a reason", async () => {
    const { service } = create();
    const request = await service.requestPayment(owner, {
      ...input,
      evidence: "",
    });
    await service.processBatch(10);
    const result = await service.getPayment(owner, request.id);
    expect(result.status).toBe("needs_information");
    expect(result.decisionReason).toContain("provide invoice");
  });
  it("expires a queued request after the approval window", async () => {
    const { service, advance } = create();
    const request = await service.requestPayment(owner, input);
    advance(3600001);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).status).toBe(
      "expired",
    );
  });
  it("recovers after broadcast timeout without preparing another transfer", async () => {
    const demo = demoPorts();
    const prepare = vi.fn(demo.settlement.prepare);
    const broadcast = vi
      .fn()
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValue("signed");
    const reconcile = vi.fn().mockResolvedValue({ status: "settled" });
    const { service, store, advance } = create(undefined, {
      settlement: { ...demo.settlement, prepare, broadcast, reconcile },
    });
    const request = await service.requestPayment(owner, input);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).status).toBe(
      "executing",
    );
    expect((await store.read()).payments[0].rawTransaction).toBeDefined();
    expect(
      (await service.getPayment(owner, request.id)).rawTransaction,
    ).toBeUndefined();
    advance(20000);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).status).toBe(
      "settled",
    );
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("rebroadcasts the same signed transaction if absent and waits for pending settlement", async () => {
    const demo = demoPorts();
    const broadcast = vi.fn(demo.settlement.broadcast);
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce({ status: "not_found" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValue({ status: "settled" });
    const { service, advance } = create(undefined, {
      settlement: { ...demo.settlement, broadcast, reconcile },
    });
    const request = await service.requestPayment(owner, input);
    await service.processBatch(10);
    advance(11000);
    await service.processBatch(10);
    advance(11000);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).status).toBe(
      "settled",
    );
    expect(new Set(broadcast.mock.calls.map((call) => call[0])).size).toBe(1);
  });
  it("records a revert without counting funds as spent", async () => {
    const demo = demoPorts();
    const { service } = create(undefined, {
      settlement: {
        ...demo.settlement,
        reconcile: async () => ({ status: "failed" }),
      },
    });
    const request = await service.requestPayment(owner, input);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).status).toBe("failed");
    expect((await service.dashboard(owner)).treasury?.totalSpent).toBe("0");
  });
  it("retries transient evaluator outages without an implicit approval", async () => {
    const demo = demoPorts();
    const { service, advance } = create(undefined, {
      governance: {
        ...demo.governance,
        submit: vi
          .fn()
          .mockRejectedValueOnce(new Error("RPC unavailable"))
          .mockImplementation(demo.governance.submit),
      },
    });
    const request = await service.requestPayment(owner, input);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).status).toBe("queued");
    advance(20000);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).status).toBe(
      "settled",
    );
  });
  it("serializes separate worker instances with a durable global lease", async () => {
    const demo = demoPorts();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { service, store, ports } = create(undefined, {
      governance: {
        ...demo.governance,
        submit: async (policy, payment) => {
          entered();
          await blocked;
          return demo.governance.submit(policy, payment);
        },
      },
    });
    const second = new AgentPayService(store, ports, "demo");
    await service.requestPayment(owner, input);
    const first = service.processBatch(1);
    await enteredPromise;
    expect(await second.processBatch(1)).toBe(0);
    release();
    await first;
    expect((await store.read()).workerLease).toBeUndefined();
  });
  it("live snapshots reject owner/token mismatch before registration", async () => {
    const demo = demoPorts();
    const { service } = create(
      { ...demoState(now), treasuries: [], policies: [] },
      {
        settlement: {
          ...demo.settlement,
          snapshot: async () => ({ ...snapshot(), owner: recipient }),
        },
      },
      "live",
    );
    await expect(
      service.setup(owner, {
        ...policyInput(),
        treasuryId: recipient,
        agentName: "Live agent",
      }),
    ).rejects.toMatchObject({ code: "VAULT_MISMATCH" });
  });
  it("live policy update requires a newer on-chain mandate", async () => {
    const demo = demoPorts();
    const { service } = create(
      undefined,
      { settlement: { ...demo.settlement, snapshot: async () => snapshot() } },
      "live",
    );
    await expect(
      service.updatePolicy(owner, policyInput()),
    ).rejects.toMatchObject({ code: "POLICY_NOT_CONFIGURED" });
  });
  it("live execution records a real transaction reference from its adapter", async () => {
    const demo = demoPorts();
    const hash = hashText("integration tx fixture");
    const { service } = create(
      undefined,
      {
        settlement: {
          ...demo.settlement,
          snapshot: async () => snapshot(),
          prepare: async () => ({ hash, rawTransaction: "signed fixture" }),
          broadcast: async () => hash,
          reconcile: async () => ({ status: "settled", transactionHash: hash }),
        },
      },
      "live",
    );
    const request = await service.requestPayment(owner, input);
    await service.processBatch(10);
    expect((await service.getPayment(owner, request.id)).transactionHash).toBe(
      hash,
    );
  });
});

describe("reviewed authorization boundaries", () => {
  it("does not broadcast after authority changes during transaction preparation", async () => {
    const demo = demoPorts();
    const broadcast = vi.fn(demo.settlement.broadcast);
    const { service, store } = create(undefined, {
      settlement: {
        ...demo.settlement,
        broadcast,
        prepare: async (t, p) => {
          await store.update((s) => ({
            ...s,
            treasuries: s.treasuries.map((t) => ({
              ...t,
              paused: true,
              active: false,
            })),
          }));
          return demo.settlement.prepare(t, p);
        },
      },
    });
    const request = await service.requestPayment(owner, input);
    await service.processBatch(10);
    expect(broadcast).not.toHaveBeenCalled();
    expect((await service.getPayment(owner, request.id)).status).toBe("failed");
  });
  it("does not persist or broadcast a signed transaction after lease takeover", async () => {
    const demo = demoPorts();
    const broadcast = vi.fn(demo.settlement.broadcast);
    const { service, store } = create(undefined, {
      settlement: {
        ...demo.settlement,
        broadcast,
        prepare: async (t, p) => {
          await store.update((s) => ({
            ...s,
            workerLease: { token: globalThis.crypto.randomUUID(), expiresAt: now + 1000000 },
          }));
          return demo.settlement.prepare(t, p);
        },
      },
    });
    const request = await service.requestPayment(owner, input);
    await service.processBatch(10).catch(() => {});
    expect(broadcast).not.toHaveBeenCalled();
    expect(
      (await store.read()).payments.find((p) => p.id === request.id)
        ?.rawTransaction,
    ).toBeUndefined();
  });
  it("rejects registering offchain limits that differ from the vault policy", async () => {
    const demo = demoPorts();
    const next = policyInput();
    const good = {
      ...snapshot(),
      mandateHash: hashText(next.mandate),
      validUntil: next.validUntil,
    };
    const { service } = create(
      { ...demoState(now), treasuries: [], policies: [] },
      {
        settlement: {
          ...demo.settlement,
          snapshot: async () => ({ ...good, perPaymentLimit: "9" }),
        },
      },
      "live",
    );
    await expect(
      service.setup(owner, {
        ...next,
        treasuryId: recipient,
        agentName: "Live agent",
      }),
    ).rejects.toMatchObject({ code: "POLICY_NOT_CONFIGURED" });
  });
  it("rejects a recipient not verified by the onchain allowlist", async () => {
    const demo = demoPorts();
    const next = policyInput();
    const { service } = create(
      { ...demoState(now), treasuries: [], policies: [] },
      {
        settlement: {
          ...demo.settlement,
          snapshot: async () => ({
            ...snapshot(),
            mandateHash: hashText(next.mandate),
            validUntil: next.validUntil,
            recipients: [],
          }),
        },
      },
      "live",
    );
    await expect(
      service.setup(owner, {
        ...next,
        treasuryId: recipient,
        agentName: "Live agent",
      }),
    ).rejects.toMatchObject({ code: "POLICY_NOT_CONFIGURED" });
  });
  it("rejects credentials and requests after onchain ownership changes", async () => {
    const demo = demoPorts();
    let changed = false;
    const { service } = create(
      undefined,
      {
        settlement: {
          ...demo.settlement,
          snapshot: async () => ({
            ...snapshot(),
            owner: changed ? recipient : owner,
          }),
        },
      },
      "live",
    );
    const key = await service.issueCredential(owner);
    changed = true;
    await expect(service.authenticateAgent(key.key)).rejects.toMatchObject({
      code: "VAULT_MISMATCH",
    });
    await expect(service.issueCredential(owner)).rejects.toMatchObject({
      code: "VAULT_MISMATCH",
    });
    await expect(service.requestPayment(owner, input)).rejects.toMatchObject({
      code: "VAULT_MISMATCH",
    });
    await expect(service.dashboard(owner)).rejects.toMatchObject({
      code: "VAULT_MISMATCH",
    });
  });
  it("refreshes chain balances while preserving metadata version until the new mandate is registered", async () => {
    const demo = demoPorts();
    const { service } = create(
      undefined,
      {
        settlement: {
          ...demo.settlement,
          snapshot: async () => ({
            ...snapshot(),
            policyVersion: 2,
            balance: "75",
            weeklySpent: "5",
            totalSpent: "25",
          }),
        },
      },
      "live",
    );
    const dashboard = await service.dashboard(owner);
    expect(dashboard.treasury?.balance).toBe("75");
    expect(dashboard.treasury?.policyVersion).toBe(1);
    expect(dashboard.policy?.version).toBe(1);
    expect(dashboard.treasury?.active).toBe(false);
  });
});

describe("live control policy metadata integrity", () => {
  it("preserves registered metadata across funding and then imports the confirmed new mandate", async () => {
    const demo = demoPorts();
    const next = policyInput();
    const chain = {
      ...snapshot(),
      policyVersion: 2,
      mandateHash: hashText(next.mandate),
      validUntil: next.validUntil,
      balance: "120",
    };
    const { service, store } = create(
      undefined,
      { settlement: { ...demo.settlement, snapshot: async () => chain } },
      "live",
    );
    await service.control(owner, { action: "fund", amount: "20" });
    const stored = await store.read();
    expect(stored.treasuries[0].policyVersion).toBe(1);
    expect(stored.treasuries[0].active).toBe(false);
    expect(stored.policies).toHaveLength(1);
    await service.updatePolicy(owner, next);
    const imported = await store.read();
    expect(imported.treasuries[0].policyVersion).toBe(2);
    expect(imported.policies[1].mandate).toBe(next.mandate);
  });
  it("does not clone old text onto a differently configured live resume mandate", async () => {
    const demo = demoPorts();
    const state = mutate(demoState(now), { paused: true, active: false });
    const { service, store } = create(
      state,
      {
        settlement: {
          ...demo.settlement,
          snapshot: async () => ({
            ...snapshot(),
            policyVersion: 2,
            mandateHash: hashText("A different mandate"),
          }),
        },
      },
      "live",
    );
    await expect(
      service.control(owner, { action: "resume" }),
    ).rejects.toMatchObject({ code: "POLICY_NOT_CONFIGURED" });
    const stored = await store.read();
    expect(stored.treasuries[0].policyVersion).toBe(1);
    expect(stored.policies).toHaveLength(1);
  });
  it("imports a resumed live version only when text, limits, expiry and recipients match", async () => {
    const demo = demoPorts();
    const state = mutate(demoState(now), { paused: true, active: false });
    const { service, store } = create(
      state,
      {
        settlement: {
          ...demo.settlement,
          snapshot: async () => ({ ...snapshot(), policyVersion: 2 }),
        },
      },
      "live",
    );
    await service.control(owner, { action: "resume" });
    const stored = await store.read();
    expect(stored.treasuries[0].policyVersion).toBe(2);
    expect(stored.policies).toHaveLength(2);
    expect(stored.policies[1].mandate).toBe(stored.policies[0].mandate);
  });
});
