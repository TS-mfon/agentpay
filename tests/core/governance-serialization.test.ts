import { describe, it, expect, vi } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import {
  demoState,
  demoPorts,
  DEMO_OWNER,
  DEMO_RECIPIENT,
} from "../../src/server/demo";
import type { Ports, PolicyDecision } from "../../src/core/ports";
import type { Policy, Payment } from "../../src/core/types";
const initialTime = 1900000000000;
const input = {
  recipient: DEMO_RECIPIENT,
  amount: "4",
  service: "Research API",
  purpose: "Market research data",
  evidence: "Dataset invoice with verified service scope",
  idempotencyKey: "serialized-0001",
};
function create(overrides: Partial<Ports> = {}) {
  let time = initialTime;
  const store = new MemoryStore(demoState(time));
  const ports = { ...demoPorts(), ...overrides, now: () => time };
  return {
    store,
    service: new AgentPayService(store, ports, "demo"),
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const unavailable = {
  finalized: true,
  status: "unavailable",
  reason: "Finalized evaluation record unavailable.",
  requestHash: "",
  mandateHash: "",
} as PolicyDecision;
describe("serialized governance and missing-record recovery", () => {
  it("does not submit another evaluation before the first decision finalizes", async () => {
    const demo = demoPorts();
    const submit = vi.fn(demo.governance.submit);
    const { service } = create({
      governance: {
        ...demo.governance,
        submit,
        inspect: async (_ref, p) => ({
          finalized: false,
          status: "pending",
          reason: "Pending",
          requestHash: p.requestHash,
          mandateHash: p.mandateHash,
        }),
      },
    });
    await service.requestPayment(DEMO_OWNER, input);
    await service.requestPayment(DEMO_OWNER, {
      ...input,
      idempotencyKey: "serialized-0002",
    });
    await service.processBatch(10);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("a waiting finality lease blocks later queued submissions across worker runs", async () => {
    const demo = demoPorts();
    const submit = vi.fn(demo.governance.submit);
    const { service, store } = create({
      governance: { ...demo.governance, submit },
    });
    const first = await service.requestPayment(DEMO_OWNER, input);
    await service.requestPayment(DEMO_OWNER, {
      ...input,
      idempotencyKey: "serialized-0002",
    });
    await service.processBatch(1);
    await store.update((s) => ({
      ...s,
      payments: s.payments.map((p) =>
        p.id === first.id ? { ...p, leaseUntil: initialTime + 60000 } : p,
      ),
    }));
    expect(await service.processBatch(10)).toBe(0);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("re-evaluates the same request at most twice and preserves every decision reference", async () => {
    const demo = demoPorts();
    let sequence = 0;
    const submit = vi.fn(
      async (_policy: Policy, _payment: Payment) => "evaluation-" + sequence++,
    );
    const prepare = vi.fn(demo.settlement.prepare);
    const { service } = create({
      governance: {
        ...demo.governance,
        submit,
        inspect: async () => unavailable,
      },
      settlement: { ...demo.settlement, prepare },
    });
    const request = await service.requestPayment(DEMO_OWNER, input);
    await service.processBatch(20);
    const result = await service.getPayment(DEMO_OWNER, request.id);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("unavailable");
    expect(result.evaluationRecoveryAttempts).toBe(2);
    expect(result.evaluationReferences).toEqual([
      "evaluation-0",
      "evaluation-1",
      "evaluation-2",
    ]);
    expect(submit).toHaveBeenCalledTimes(3);
    expect(
      submit.mock.calls.every(
        (call) =>
          call[1]?.id === request.id &&
          call[1]?.requestHash === request.requestHash &&
          call[0]?.version === request.policyVersion,
      ),
    ).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("permits a recovered finalized approval while preserving original request binding", async () => {
    const demo = demoPorts();
    let sequence = 0;
    const submit = vi.fn(
      async (_policy: Policy, _payment: Payment) => "evaluation-" + sequence++,
    );
    let inspected = 0;
    const { service } = create({
      governance: {
        ...demo.governance,
        submit,
        inspect: async (ref, p) =>
          inspected++ === 0 ? unavailable : demo.governance.inspect(ref, p),
      },
    });
    const request = await service.requestPayment(DEMO_OWNER, input);
    await service.processBatch(20);
    const result = await service.getPayment(DEMO_OWNER, request.id);
    expect(result.status).toBe("settled");
    expect(result.evaluationRecoveryAttempts).toBe(1);
    expect(result.evaluationReferences).toEqual([
      "evaluation-0",
      "evaluation-1",
    ]);
  });
  it("does not recover or pay from an unfinalized unavailable result", async () => {
    const demo = demoPorts();
    const submit = vi.fn(demo.governance.submit);
    const prepare = vi.fn(demo.settlement.prepare);
    const { service } = create({
      governance: {
        ...demo.governance,
        submit,
        inspect: async () => ({ ...unavailable, finalized: false }),
      },
      settlement: { ...demo.settlement, prepare },
    });
    const request = await service.requestPayment(DEMO_OWNER, input);
    await service.processBatch(10);
    expect((await service.getPayment(DEMO_OWNER, request.id)).status).toBe(
      "awaiting_finality",
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("recovery authorization boundaries", () => {
  it("does not submit a recovery after the owner suspends authority during inspection", async () => {
    const demo = demoPorts();
    const submit = vi.fn(demo.governance.submit);
    const { service, store } = create({
      governance: {
        ...demo.governance,
        submit,
        inspect: async () => {
          await store.update((s) => ({
            ...s,
            treasuries: s.treasuries.map((t) => ({
              ...t,
              paused: true,
              active: false,
            })),
          }));
          return unavailable;
        },
      },
    });
    const request = await service.requestPayment(DEMO_OWNER, input);
    await service.processBatch(10);
    expect(submit).toHaveBeenCalledTimes(1);
    expect((await service.getPayment(DEMO_OWNER, request.id)).status).toBe(
      "failed",
    );
  });
  it("does not submit recovery after another worker takes the execution lease", async () => {
    const demo = demoPorts();
    const submit = vi.fn(demo.governance.submit);
    const { service, store } = create({
      governance: {
        ...demo.governance,
        submit,
        inspect: async () => {
          await store.update((s) => ({
            ...s,
            workerLease: {
              token: "new-worker",
              expiresAt: initialTime + 1000000,
            },
          }));
          return unavailable;
        },
      },
    });
    await service.requestPayment(DEMO_OWNER, input);
    await service.processBatch(10).catch(() => {});
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
