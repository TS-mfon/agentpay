import { it, expect } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState, demoPorts, DEMO_OWNER, DEMO_RECIPIENT } from "../../src/server/demo";

it("never returns signed governance or registration payloads to request callers or history readers", async () => {
  const store = new MemoryStore(demoState());
  const service = new AgentPayService(store, demoPorts(), "demo");
  const input = { recipient: DEMO_RECIPIENT, amount: "1", service: "Research API", purpose: "Market research data", evidence: "Research subscription", idempotencyKey: "journal-privacy-0001" };
  const request = await service.requestPayment(DEMO_OWNER, input);
  await store.update(s => ({ ...s, payments: s.payments.map(p => ({ ...p,
    rawTransaction: "private-executor-envelope",
    rawGovernanceTransaction: "private-governance-envelope",
    policyRegistration: { reference: "registration-reference", rawTransaction: "private-registration-envelope" },
  })) }));
  const responses = [await service.getPayment(DEMO_OWNER, request.id), await service.requestPayment(DEMO_OWNER, input), await service.dashboard(DEMO_OWNER)];
  for (const response of responses) {
    expect(JSON.stringify(response)).not.toContain("private-executor-envelope");
    expect(JSON.stringify(response)).not.toContain("private-governance-envelope");
    expect(JSON.stringify(response)).not.toContain("private-registration-envelope");
  }
  expect((await store.read()).payments[0].rawGovernanceTransaction).toBe("private-governance-envelope");
});
