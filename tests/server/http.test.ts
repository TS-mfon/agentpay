import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { AppError } from "../../src/core/errors";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState, DEMO_OWNER } from "../../src/server/demo";
const fixture = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("../../src/server/runtime", () => ({
  getRuntime: async () => fixture.runtime,
}));
import { handle, owner, agent, body, success } from "../../src/server/http";
beforeEach(() => {
  fixture.runtime = {
    mode: "demo",
    store: new MemoryStore(demoState()),
    auth: { owner: vi.fn(async () => DEMO_OWNER) },
    service: {
      authenticateAgent: vi.fn(async () => ({
        owner: DEMO_OWNER,
        agentId: "agent",
        treasuryId: "vault",
      })),
    },
  };
});
const request = (headers: HeadersInit = {}) =>
  new Request("http://localhost:3000/api/test", { headers });
describe("API envelope and boundary security", () => {
  it("returns no-store success and preserves response cookies", async () => {
    const response = await handle(request(), async () => ({ amount: "4" }));
    expect(await response.json()).toEqual({
      success: true,
      data: { amount: "4" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = success({ signedIn: true });
    cookie.cookies.set("session", "test", { httpOnly: true });
    const returned = await handle(request(), async () => cookie);
    expect(returned.headers.get("set-cookie")).toContain("HttpOnly");
  });
  it("returns bounded domain errors and suppresses internal exception details", async () => {
    const response = await handle(request(), async () => {
      throw new AppError("PAYMENT_LIMIT", "Payment exceeds budget.", 400);
    });
    expect(response.status).toBe(400);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await handle(request(), async () => {
      throw new Error("sensitive database connection detail");
    });
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("sensitive");
    log.mockRestore();
  });
  it("enforces same-origin demo owner actions and live cookie sessions", async () => {
    const runtime = fixture.runtime as Parameters<typeof owner>[1];
    expect(
      await owner(request({ origin: "http://localhost:3000" }), runtime, true),
    ).toBe(DEMO_OWNER);
    await expect(owner(request(), runtime, true)).rejects.toMatchObject({
      code: "INVALID_ORIGIN",
    });
    const live = { ...runtime, mode: "live" as const };
    expect(
      await owner(request({ cookie: "other=1; agentpay_session=token" }), live),
    ).toBe(DEMO_OWNER);
    expect(live.auth.owner).toHaveBeenCalledWith("token");
  });
  it("requires bearer credentials for the agent API", async () => {
    const runtime = fixture.runtime as Parameters<typeof agent>[1];
    await expect(agent(request(), runtime)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(
      (await agent(request({ authorization: "Bearer ap_key" }), runtime))
        .agentId,
    ).toBe("agent");
  });
  it("accepts JSON and rejects malformed, oversized, or wrong-type bodies", async () => {
    const json = (text: string) =>
      new Request("http://localhost:3000", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
    expect(await body(json('{"amount":"4"}'))).toEqual({ amount: "4" });
    await expect(body(json("{"))).rejects.toMatchObject({
      code: "INVALID_JSON",
    });
    await expect(body(json("x".repeat(16001)))).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
    });
    await expect(
      body(
        new Request("http://localhost:3000", { method: "POST", body: "hello" }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT_TYPE" });
  });
});

describe("policy receipt transport handling", () => {
  it("accepts a valid transaction hint without interpreting it as policy authority", async () => {
    const { AgentPayService } = await import("../../src/core/service");
    const { demoPorts } = await import("../../src/server/demo");
    const runtime = fixture.runtime as Parameters<typeof owner>[1];
    runtime.service = new AgentPayService(runtime.store, demoPorts(), "demo");
    const state = await runtime.store.read();
    const { treasuryId, agentId, version, mandateHash, ...policy } =
      state.policies[0];
    const proof = "0x" + "ab".repeat(32);
    const req = new Request("http://localhost:3000/api/owner/policy", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...policy, txHash: proof }),
    });
    const response = await handle(req, async (r) =>
      r.service.updatePolicy(await owner(req, r, true), await body(req)),
    );
    expect(response.status).toBe(200);
    expect((await runtime.store.read()).policies.at(-1)?.version).toBe(2);
    expect(JSON.stringify((await runtime.store.read()).policies)).not.toContain(
      proof,
    );
  });
  it("rejects malformed receipt hints and unknown policy fields without changing authority", async () => {
    const { AgentPayService } = await import("../../src/core/service");
    const { demoPorts } = await import("../../src/server/demo");
    const runtime = fixture.runtime as Parameters<typeof owner>[1];
    runtime.service = new AgentPayService(runtime.store, demoPorts(), "demo");
    const state = await runtime.store.read();
    const { treasuryId, agentId, version, mandateHash, ...policy } =
      state.policies[0];
    for (const patch of [
      { txHash: "not-a-hash" },
      { runtimeAgent: "unexpected" },
    ]) {
      const req = new Request("http://localhost:3000/api/owner/policy", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...policy, ...patch }),
      });
      const response = await handle(req, async (r) =>
        r.service.updatePolicy(await owner(req, r, true), await body(req)),
      );
      expect(response.status).toBe(400);
    }
    expect((await runtime.store.read()).policies).toHaveLength(1);
  });
});
