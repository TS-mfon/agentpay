import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import {
  demoState,
  demoPorts,
  DEMO_OWNER,
  DEMO_RECIPIENT,
} from "../../src/server/demo";
import { OwnerAuth } from "../../src/server/auth";
import { hashText } from "../../src/core/validation";
const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("../../src/server/runtime", () => ({
  getRuntime: async () => holder.runtime,
}));
import { GET } from "../../src/app/api/v1/services/research/route";
let service: AgentPayService;
let key: string;
const payment = {
  recipient: DEMO_RECIPIENT,
  amount: "4",
  service: "Research API",
  purpose: "Research the Aevum integration",
  evidence: "Sample research dataset invoice for the assigned mandate.",
  idempotencyKey: "fulfillment-0001",
};
const request = (paymentId?: string, bearer = key) =>
  new Request(
    "http://localhost:3000/api/v1/services/research" +
      (paymentId ? "?paymentId=" + paymentId : ""),
    { headers: bearer ? { authorization: "Bearer " + bearer } : {} },
  );
beforeEach(async () => {
  const store = new MemoryStore(demoState());
  service = new AgentPayService(store, demoPorts(), "demo");
  holder.runtime = { mode: "demo", store, service, auth: new OwnerAuth(store) };
  key = (await service.issueCredential(DEMO_OWNER)).key;
});
describe("paid research resource fulfillment", () => {
  it("returns honestly labeled sample research only after an authorized settled payment", async () => {
    const receipt = await service.requestPayment(DEMO_OWNER, payment);
    await service.processBatch(10);
    const response = await GET(request(receipt.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.paymentId).toBe(receipt.id);
    expect(body.data.dataset.kind).toBe("sample");
    expect(body.data.dataset.records.length).toBeGreaterThan(0);
    expect(
      body.data.dataset.records.every((record: { sources: string[] }) =>
        record.sources.every((url) => url.startsWith("https://")),
      ),
    ).toBe(true);
  });
  it("rejects unpaid and semantically rejected requests with payment-required", async () => {
    const unpaid = await service.requestPayment(DEMO_OWNER, payment);
    expect((await GET(request(unpaid.id))).status).toBe(402);
    const rejected = await service.requestPayment(DEMO_OWNER, {
      ...payment,
      service: "Gaming subscription",
      purpose: "Entertainment game subscription",
      idempotencyKey: "fulfillment-0002",
    });
    await service.processBatch(10);
    expect((await GET(request(rejected.id))).status).toBe(402);
  });
  it("does not fulfill a settled payment for another service", async () => {
    const other = await service.requestPayment(DEMO_OWNER, {
      ...payment,
      service: "Analysis compute",
      purpose: "Compute for research datasets",
    });
    await service.processBatch(10);
    expect((await GET(request(other.id))).status).toBe(402);
  });
  it("requires an existing payment reference and agent credential", async () => {
    expect((await GET(request())).status).toBe(400);
    expect((await GET(request(hashText("missing")))).status).toBe(404);
    expect((await GET(request(hashText("missing"), ""))).status).toBe(401);
  });
  it("does not expose another agent treasury receipt", async () => {
    const receipt = await service.requestPayment(DEMO_OWNER, payment);
    await service.processBatch(10);
    const other = "0x7777777777777777777777777777777777777777";
    await service.store.update((state) => ({
      ...state,
      treasuries: [
        ...state.treasuries,
        {
          ...state.treasuries[0],
          id: other,
          owner: other,
          agentId: hashText("foreign agent"),
        },
      ],
      policies: [
        ...state.policies,
        {
          ...state.policies[0],
          treasuryId: other,
          agentId: hashText("foreign agent"),
        },
      ],
    }));
    const foreign = (await service.issueCredential(other)).key;
    expect((await GET(request(receipt.id, foreign))).status).toBe(404);
  });
});
