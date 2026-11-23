import { describe, it, expect } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState, demoPorts } from "../../src/server/demo";

const owner = "0x1111111111111111111111111111111111111111";
const payment = {
  recipient: "0x2222222222222222222222222222222222222222",
  amount: "4",
  service: "Research API",
  purpose: "Market research data",
  evidence: "Verified research dataset subscription",
  idempotencyKey: "research-001",
};
function create() {
  const store = new MemoryStore(demoState());
  return { store, service: new AgentPayService(store, demoPorts(), "demo") };
}

describe("financial authorization", () => {
  it("settles an approved request and preserves a complete receipt", async () => {
    const { service } = create();
    const request = await service.requestPayment(owner, payment);
    await service.processBatch(5);
    await service.processBatch(5);
    await service.processBatch(5);
    const result = await service.getPayment(owner, request.id);
    expect(result.status).toBe("settled");
    expect(result.decisionReason).toContain("research");
    expect(result.transactionHash).toBeUndefined();
  });
  it("rejects an over-cap request before semantic evaluation", async () => {
    const { service } = create();
    await expect(
      service.requestPayment(owner, { ...payment, amount: "10.000001" }),
    ).rejects.toMatchObject({ code: "PAYMENT_LIMIT" });
  });
  it("rejects conflicting idempotency input and returns same request for retries", async () => {
    const { service } = create();
    const first = await service.requestPayment(owner, payment);
    const second = await service.requestPayment(owner, payment);
    expect(second.id).toBe(first.id);
    await expect(
      service.requestPayment(owner, { ...payment, amount: "5" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("denies an unrelated service despite fitting the numeric budget", async () => {
    const { service } = create();
    const request = await service.requestPayment(owner, {
      ...payment,
      service: "Gaming subscription",
      purpose: "Purchase a game",
      evidence: "Game entertainment invoice",
    });
    await service.processBatch(5);
    await service.processBatch(5);
    const result = await service.getPayment(owner, request.id);
    expect(result.status).toBe("rejected");
  });
});
