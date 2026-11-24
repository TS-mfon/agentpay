import { describe, it, expect, vi } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState, demoPorts, DEMO_OWNER, DEMO_RECIPIENT } from "../../src/server/demo";
import type { Ports } from "../../src/core/ports";
import type { GovernanceSubmission } from "../../src/core/ports";
import type { Policy, Payment } from "../../src/core/types";
import { AppError } from "../../src/core/errors";

const started = 1900000000000;
const input = { recipient: DEMO_RECIPIENT, amount: "1", service: "Research API", purpose: "Market research data", evidence: "Research dataset subscription", idempotencyKey: "queue-recovery-0001" };
function create(overrides: Partial<Ports> = {}) {
  let time = started;
  const store = new MemoryStore(demoState(time));
  const ports = { ...demoPorts(), ...overrides, now: () => time };
  return { store, ports, service: new AgentPayService(store, ports, "demo"), advance: (ms: number) => { time += ms; } };
}

describe("queue progress during independent waits", () => {
  it.each(["expired", "failed"] as const)("normalizes a legacy %s decision reference once and drains it without paying", async status => {
    const demo = demoPorts();
    const inspect = vi.fn(demo.governance.inspect);
    const prepare = vi.fn(demo.settlement.prepare);
    const env = create({ governance: { ...demo.governance, inspect }, settlement: { ...demo.settlement, prepare } });
    const request = await env.service.requestPayment(DEMO_OWNER, input);
    await env.store.update(s => ({ ...s, payments: s.payments.map(p => ({ ...p, status, decisionRef: "legacy-finalized-record" })) }));
    await env.service.processBatch(10);
    await env.service.processBatch(10);
    expect((await env.service.getPayment(DEMO_OWNER, request.id)).status).toBe(status);
    expect(inspect).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("drains a finalized failed evaluation without keeping newer requests behind its barrier", async () => {
    const demo = demoPorts();
    let failedId = "";
    const env = create({ governance: { ...demo.governance, inspect: async (reference, payment) => {
      if (payment.id === failedId) throw new AppError("EVALUATION_FAILED", "Finalized evaluation failed.", 503);
      return demo.governance.inspect(reference, payment);
    } } });
    const first = await env.service.requestPayment(DEMO_OWNER, input);
    failedId = first.id;
    const second = await env.service.requestPayment(DEMO_OWNER, { ...input, idempotencyKey: "queue-after-final-error-0002" });
    await env.store.update(s => ({ ...s, payments: s.payments.map(p => p.id === first.id
      ? { ...p, status: "expired", decisionRef: "failed-finalized-record", governanceUnresolved: true } : p) }));
    await env.service.processBatch(10);
    expect((await env.service.getPayment(DEMO_OWNER, first.id)).status).toBe("expired");
    expect((await env.service.getPayment(DEMO_OWNER, second.id)).status).toBe("settled");
  });
  it("drains an expired signed policy registration using its own envelope without creating a new write", async () => {
    const demo = demoPorts();
    const submit = vi.fn(demo.governance.submit);
    const inspect = vi.fn(async (_reference: string, p: Payment) => ({ finalized: true, status: "unavailable" as const,
      reason: "No payment decision for policy registration", requestHash: p.requestHash, mandateHash: p.mandateHash }));
    const env = create({ governance: { ...demo.governance, submit, inspect } });
    const request = await env.service.requestPayment(DEMO_OWNER, input);
    await env.store.update(s => ({ ...s, payments: s.payments.map(p => ({ ...p, status: "expired", governanceUnresolved: true,
      policyRegistration: { reference: "registered-finalized-record", rawTransaction: "signed-policy-envelope" } })) }));
    await env.service.processBatch(10);
    expect((await env.service.getPayment(DEMO_OWNER, request.id)).status).toBe("expired");
    expect(inspect.mock.calls[0][0]).toBe("registered-finalized-record");
    expect(inspect.mock.calls[0][1].rawGovernanceTransaction).toBe("signed-policy-envelope");
    expect(submit).not.toHaveBeenCalled();
  });
  it("stops automatic pre-sign retries after six transient failures without authorizing funds", async () => {
    const demo = demoPorts();
    const register = vi.fn(async () => { throw new Error("RPC unavailable before signing"); });
    const prepare = vi.fn(demo.settlement.prepare);
    const env = create({ governance: { ...demo.governance, register }, settlement: { ...demo.settlement, prepare } });
    const request = await env.service.requestPayment(DEMO_OWNER, input);
    for (let attempt = 0; attempt < 6; attempt++) { await env.service.processBatch(10); env.advance(300000); }
    expect(await env.service.getPayment(DEMO_OWNER, request.id)).toMatchObject({ status: "failed", consecutiveFailures: 6 });
    await env.service.processBatch(10);
    expect(register).toHaveBeenCalledTimes(6);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("keeps ordinary finality polls pending without consuming the outage failure budget", async () => {
    const demo = demoPorts();
    const submit = vi.fn(demo.governance.submit);
    const env = create({ governance: { ...demo.governance, submit, inspect: async (_reference, p) => ({
      finalized: false, status: "pending", reason: "Awaiting consensus", requestHash: p.requestHash, mandateHash: p.mandateHash }) } });
    const request = await env.service.requestPayment(DEMO_OWNER, input);
    for (let poll = 0; poll < 8; poll++) { await env.service.processBatch(10); env.advance(300000); }
    expect(await env.service.getPayment(DEMO_OWNER, request.id)).toMatchObject({ status: "awaiting_finality", consecutiveFailures: 0 });
    expect(submit).toHaveBeenCalledOnce();
  });
  it("retains an uncertain executor envelope after repeated outages and never prepares a second nonce", async () => {
    const demo = demoPorts();
    const reconcile = vi.fn(async (_payment: Payment) => { throw new Error("Aevum RPC unavailable"); });
    const prepare = vi.fn(demo.settlement.prepare);
    const env = create({ settlement: { ...demo.settlement, reconcile, prepare } });
    const first = await env.service.requestPayment(DEMO_OWNER, input);
    const second = await env.service.requestPayment(DEMO_OWNER, { ...input, idempotencyKey: "queue-next-nonce-0002" });
    await env.store.update(s => ({ ...s, payments: s.payments.map(p => p.id === first.id
      ? { ...p, status: "executing", rawTransaction: "signed-uncertain-payment", transactionHash: "known-uncertain-payment" }
      : { ...p, status: "approved" }) }));
    for (let retry = 0; retry < 8; retry++) { await env.service.processBatch(10); env.advance(300000); }
    expect((await env.service.getPayment(DEMO_OWNER, first.id)).status).toBe("executing");
    expect((await env.service.getPayment(DEMO_OWNER, second.id)).status).toBe("approved");
    expect(prepare).not.toHaveBeenCalled();
    expect(reconcile.mock.calls.every(call => call[0].rawTransaction === "signed-uncertain-payment")).toBe(true);
  });
  it("reuses the prepared policy registration after losing its response instead of signing another policy write", async () => {
    const demo = demoPorts();
    const registration = { reference: "known-policy-registration", rawTransaction: "signed-policy-registration" };
    let first = true;
    const register = vi.fn(async (_policy: Policy, options?: GovernanceSubmission) => {
      if (first) { first = false; await options?.onPrepared?.(registration); throw new Error("Registration response lost"); }
      expect(options?.prepared).toEqual(registration);
    });
    const env = create({ governance: { ...demo.governance, register } });
    const request = await env.service.requestPayment(DEMO_OWNER, input);
    await env.service.processBatch(1);
    expect((await env.service.getPayment(DEMO_OWNER, request.id)).status).toBe("evaluating");
    env.advance(60000);
    await env.service.processBatch(10);
    expect((await env.service.getPayment(DEMO_OWNER, request.id)).status).toBe("settled");
    expect(register).toHaveBeenCalledTimes(2);
  });
  it("releases a mined nonce after receipt verification fails while retaining a manual-review warning", async () => {
    const demo = demoPorts();
    let minedId = "";
    const prepare = vi.fn(demo.settlement.prepare);
    const env = create({ settlement: { ...demo.settlement, prepare, reconcile: async payment => payment.id === minedId
      ? { status: "verification_failed", reason: "Successful transaction did not prove the requested payment." }
      : demo.settlement.reconcile(payment) } });
    const first = await env.service.requestPayment(DEMO_OWNER, input);
    minedId = first.id;
    const second = await env.service.requestPayment(DEMO_OWNER, { ...input, idempotencyKey: "queue-after-mined-0002" });
    await env.store.update(s => ({ ...s, payments: s.payments.map(p => p.id === first.id
      ? { ...p, status: "executing", rawTransaction: "signed-mined-payment", transactionHash: "mined-receipt-to-review" }
      : { ...p, status: "approved" }) }));
    await env.service.processBatch(10);
    expect(await env.service.getPayment(DEMO_OWNER, first.id)).toMatchObject({ status: "failed", transactionHash: "mined-receipt-to-review" });
    expect((await env.service.getPayment(DEMO_OWNER, first.id)).error).toContain("review");
    expect((await env.service.getPayment(DEMO_OWNER, second.id)).status).toBe("settled");
    expect(prepare.mock.calls.every(call => call[1].id !== first.id)).toBe(true);
  });
  it("does not record an old-owner approval when ownership changes during finality inspection", async () => {
    const demo = demoPorts();
    const newOwner = "0x3333333333333333333333333333333333333333";
    const env = create({ governance: { ...demo.governance, inspect: async (reference, payment) => {
      await env.store.update(s => ({ ...s, treasuries: s.treasuries.map(t => ({ ...t, owner: newOwner })) }));
      return demo.governance.inspect(reference, payment);
    } } });
    const request = await env.service.requestPayment(DEMO_OWNER, input);
    await env.service.processBatch(1);
    await env.service.processBatch(1);
    expect((await env.service.getPayment(newOwner, request.id)).status).toBe("failed");
  });
  it("does not revive approval when the owner pauses the agent during the finalized decision read", async () => {
    const demo = demoPorts();
    const prepare = vi.fn(demo.settlement.prepare);
    const env = create({ governance: { ...demo.governance, inspect: async (reference, payment) => {
      await env.service.control(DEMO_OWNER, { action: "pause" });
      return demo.governance.inspect(reference, payment);
    } }, settlement: { ...demo.settlement, prepare } });
    const request = await env.service.requestPayment(DEMO_OWNER, input);
    await env.service.processBatch(1);
    await env.service.processBatch(1);
    expect((await env.service.getPayment(DEMO_OWNER, request.id)).status).toBe("expired");
    expect(prepare).not.toHaveBeenCalled();
  });
  it("drains an expired unresolved governance write before new submissions and never pays the expired request", async () => {
    const demo = demoPorts();
    let oldId = "", finalized = false;
    const submit = vi.fn(demo.governance.submit);
    const prepare = vi.fn(demo.settlement.prepare);
    const inspect = vi.fn(async (reference: string, payment: Payment) => {
      if (payment.id === oldId && !finalized) return { finalized: false, status: "pending" as const,
        reason: "Consensus pending", requestHash: payment.requestHash, mandateHash: payment.mandateHash };
      return demo.governance.inspect(reference, payment);
    });
    const { service, store, advance } = create({ governance: { ...demo.governance, submit, inspect }, settlement: { ...demo.settlement, prepare } });
    const first = await service.requestPayment(DEMO_OWNER, input);
    oldId = first.id;
    const second = await service.requestPayment(DEMO_OWNER, { ...input, idempotencyKey: "queue-after-expired-0002" });
    await store.update(s => ({ ...s, payments: s.payments.map(p => p.id === first.id
      ? { ...p, status: "awaiting_finality", decisionRef: "old-unresolved", rawGovernanceTransaction: "signed-old-governance",
        governanceUnresolved: true, expiresAt: new Date(started - 1000).toISOString() } : p) }));
    await service.processBatch(10);
    expect((await service.getPayment(DEMO_OWNER, first.id)).status).toBe("expired");
    expect((await service.getPayment(DEMO_OWNER, second.id)).status).toBe("queued");
    expect(submit).not.toHaveBeenCalled();
    finalized = true;
    advance(20000);
    await service.processBatch(10);
    expect((await service.getPayment(DEMO_OWNER, first.id)).status).toBe("expired");
    expect((await service.getPayment(DEMO_OWNER, second.id)).status).toBe("settled");
    expect(prepare.mock.calls.every(call => call[1].id !== first.id)).toBe(true);
  });
  it("reconciles the journaled evaluation after its broadcast response is lost without signing another write", async () => {
    const demo = demoPorts();
    const submit = vi.fn(async (_policy: Policy, _payment: Payment, options?: GovernanceSubmission) => {
      await options?.onPrepared?.({ reference: "known-evaluation", rawTransaction: "signed-governance-envelope" });
      throw new Error("Broadcast response lost");
    });
    const inspect = vi.fn(demo.governance.inspect);
    const { service, advance } = create({ governance: { ...demo.governance, submit, inspect } });
    const request = await service.requestPayment(DEMO_OWNER, input);
    await service.processBatch(1);
    expect(await service.getPayment(DEMO_OWNER, request.id)).toMatchObject({ status: "awaiting_finality", decisionRef: "known-evaluation" });
    advance(60000);
    await service.processBatch(5);
    expect((await service.getPayment(DEMO_OWNER, request.id)).status).toBe("settled");
    expect(submit).toHaveBeenCalledOnce();
    expect(inspect.mock.calls[0][1].rawGovernanceTransaction).toBe("signed-governance-envelope");
  });
  it("backs off an unbroadcast request without leasing or hiding a healthy queued request", async () => {
    const demo = demoPorts();
    const submit = vi.fn(async (policy: Policy, payment: Payment) => {
      if (payment.idempotencyKey === input.idempotencyKey) throw new Error("RPC unavailable before signing");
      return demo.governance.submit(policy, payment);
    });
    const { service } = create({ governance: { ...demo.governance, submit } });
    const first = await service.requestPayment(DEMO_OWNER, input);
    const second = await service.requestPayment(DEMO_OWNER, { ...input, idempotencyKey: "queue-healthy-0002" });
    await service.processBatch(10);
    const pending = await service.getPayment(DEMO_OWNER, first.id);
    expect(pending.status).toBe("queued");
    expect(pending.retryAt).toBeGreaterThan(started);
    expect(pending.leaseUntil).toBeUndefined();
    expect((await service.getPayment(DEMO_OWNER, second.id)).status).toBe("settled");
    expect(submit.mock.calls.filter(call => call[1].id === first.id)).toHaveLength(1);
  });
  it("expires an overdue queued request without RPC when the first governance poll is not due", async () => {
    const demo = demoPorts();
    const inspect = vi.fn(demo.governance.inspect);
    const { store, service } = create({ governance: { ...demo.governance, inspect } });
    const first = await service.requestPayment(DEMO_OWNER, input);
    const second = await service.requestPayment(DEMO_OWNER, { ...input, idempotencyKey: "queue-expiry-0002" });
    await store.update(s => ({ ...s, payments: s.payments.map(p => p.id === first.id
      ? { ...p, status: "awaiting_finality", decisionRef: "pending-decision", leaseUntil: started + 60000 }
      : { ...p, expiresAt: new Date(started - 1000).toISOString() }) }));
    await service.processBatch(10);
    expect((await service.getPayment(DEMO_OWNER, second.id)).status).toBe("expired");
    expect(inspect).not.toHaveBeenCalled();
  });
  it("inspects a due governance decision while an executor transaction is leased, without reusing its nonce", async () => {
    const demo = demoPorts();
    const prepare = vi.fn(demo.settlement.prepare);
    const inspect = vi.fn(demo.governance.inspect);
    const { store, service } = create({ governance: { ...demo.governance, inspect }, settlement: { ...demo.settlement, prepare } });
    const first = await service.requestPayment(DEMO_OWNER, input);
    const second = await service.requestPayment(DEMO_OWNER, { ...input, idempotencyKey: "queue-recovery-0002" });
    await store.update(s => ({ ...s, payments: s.payments.map(p => p.id === first.id
      ? { ...p, status: "executing", rawTransaction: "signed-existing-payment", leaseUntil: started + 60000 }
      : { ...p, status: "awaiting_finality", decisionRef: "decision-ready" }) }));
    await service.processBatch(10);
    expect((await service.getPayment(DEMO_OWNER, second.id)).status).toBe("approved");
    expect(inspect).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
    expect((await service.getPayment(DEMO_OWNER, first.id)).status).toBe("executing");
  });
});
