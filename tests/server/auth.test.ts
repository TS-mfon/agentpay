import { describe, it, expect, vi, afterEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  OwnerAuth,
  consumeRateLimit,
  assertOrigin,
  trustedOrigin,
} from "../../src/server/auth";
import { MemoryStore } from "../../src/server/memory-store";
import { emptyState } from "../../src/core/types";
const account = privateKeyToAccount(generatePrivateKey());
afterEach(() => vi.unstubAllEnvs());
describe("owner authentication", () => {
  it("rejects a smart-account session from the shared preview store", async () => {
    const store = new MemoryStore(emptyState());
    const auth = new OwnerAuth(store);
    const { nonce, message } = await auth.nonce(account.address, "https://agentpay.example");
    const signature = await account.signMessage({ message });
    const { token } = await auth.verify({ address: account.address, nonce, signature });
    await store.update(state => ({
      ...state,
      sessions: state.sessions.map(session => ({ ...session, signer: account.address })),
    }));
    await expect(auth.owner(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("uses one-time signed nonce, hashed session, and logout revocation", async () => {
    const store = new MemoryStore(emptyState());
    const auth = new OwnerAuth(store);
    const challenge = await auth.nonce(
      account.address,
      "https://agentpay.example",
    );
    const signature = await account.signMessage({ message: challenge.message });
    const session = await auth.verify({
      address: account.address,
      nonce: challenge.nonce,
      signature,
    });
    expect(await auth.owner(session.token)).toBe(account.address);
    expect(JSON.stringify(await store.read())).not.toContain(session.token);
    await expect(
      auth.verify({
        address: account.address,
        nonce: challenge.nonce,
        signature,
      }),
    ).rejects.toMatchObject({ code: "NONCE_EXPIRED" });
    await auth.logout(session.token);
    await expect(auth.owner(session.token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("does not accept signature over another message", async () => {
    const auth = new OwnerAuth(new MemoryStore(emptyState()));
    const challenge = await auth.nonce(
      account.address,
      "https://agentpay.example",
    );
    const signature = await account.signMessage({
      message: "Attacker message",
    });
    await expect(
      auth.verify({
        address: account.address,
        nonce: challenge.nonce,
        signature,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });
  it("expires challenges and sessions deterministically", async () => {
    let now = 1000000;
    const auth = new OwnerAuth(new MemoryStore(emptyState()), () => now);
    const challenge = await auth.nonce(
      account.address,
      "https://agentpay.example",
    );
    const signature = await account.signMessage({ message: challenge.message });
    now += 300001;
    await expect(
      auth.verify({
        address: account.address,
        nonce: challenge.nonce,
        signature,
      }),
    ).rejects.toMatchObject({ code: "NONCE_EXPIRED" });
    const next = await auth.nonce(account.address, "https://agentpay.example");
    const valid = await account.signMessage({ message: next.message });
    const session = await auth.verify({
      address: account.address,
      nonce: next.nonce,
      signature: valid,
    });
    now += 43200001;
    await expect(auth.owner(session.token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("rejects malformed proofs and missing credentials", async () => {
    const auth = new OwnerAuth(new MemoryStore(emptyState()));
    await expect(
      auth.nonce("bad", "https://agentpay.example"),
    ).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    for (const proof of [
      null,
      {},
      { address: account.address, nonce: "n", signature: "invalid" },
    ])
      await expect(auth.verify(proof)).rejects.toBeDefined();
    await expect(auth.owner(undefined)).rejects.toBeDefined();
    await auth.logout(undefined);
  });
  it("preserves the previous challenge when a fresh nonce is issued", async () => {
    const auth = new OwnerAuth(new MemoryStore(emptyState()));
    const first = await auth.nonce(account.address, "https://agentpay.example");
    await auth.nonce(account.address, "https://agentpay.example");
    const signature = await account.signMessage({ message: first.message });
    expect((await auth.verify({ address: account.address, nonce: first.nonce, signature })).owner).toBe(account.address);
  });
});
describe("persistent abuse controls", () => {
  it("shares rate counts across instances and resets after the window", async () => {
    const store = new MemoryStore(emptyState());
    await consumeRateLimit(store, "agent", 2, 60000, 1000);
    await consumeRateLimit(store, "agent", 2, 60000, 1001);
    await expect(
      consumeRateLimit(store, "agent", 2, 60000, 1002),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await consumeRateLimit(store, "agent", 2, 60000, 61001);
    expect((await store.read()).rateWindows[0].count).toBe(1);
  });
  it("fails closed if durable limits cannot be written", async () => {
    const store = {
      read: async () => emptyState(),
      update: async () => {
        throw new Error("DB unavailable");
      },
    };
    await expect(consumeRateLimit(store, "agent")).rejects.toThrow(
      "DB unavailable",
    );
  });
  it("requires same-origin for owner mutation", () => {
    const request = (origin?: string) =>
      new Request("https://agentpay.example/api/owner/controls", {
        headers: origin ? { origin } : {},
      });
    expect(() =>
      assertOrigin(request("https://agentpay.example")),
    ).not.toThrow();
    expect(() => assertOrigin(request("https://evil.example"))).toThrow();
    expect(() => assertOrigin(request())).toThrow();
    vi.stubEnv("APP_ORIGIN", "https://agentpay.example");
    expect(() =>
      assertOrigin(
        new Request("https://internal.example/api", {
          headers: { origin: "https://agentpay.example" },
        }),
      ),
    ).not.toThrow();
  });
});

describe("declared application origin", () => {
  it("rejects an attacker Origin and Host when APP_ORIGIN is configured", () => {
    vi.stubEnv("APP_ORIGIN", "https://agentpay.example");
    expect(() =>
      assertOrigin(
        new Request("https://evil.example/api/owner/controls", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
  });
});

describe("trusted preview deployment origin", () => {
  it("uses VERCEL_URL when no explicit origin is set and rejects spoofed Origin", () => {
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("VERCEL_URL", "agentpay-preview.vercel.app");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENTPAY_MODE", "live");
    const valid = new Request(
      "https://attacker-host.example/api/owner/policy",
      { headers: { origin: "https://agentpay-preview.vercel.app" } },
    );
    expect(trustedOrigin(valid)).toBe("https://agentpay-preview.vercel.app");
    expect(() => assertOrigin(valid)).not.toThrow();
    expect(() =>
      assertOrigin(
        new Request("https://attacker-host.example/api/owner/policy", {
          headers: { origin: "https://attacker-host.example" },
        }),
      ),
    ).toThrow();
  });
  it("keeps explicit APP_ORIGIN ahead of platform preview URL", () => {
    vi.stubEnv("APP_ORIGIN", "https://agentpay.example");
    vi.stubEnv("VERCEL_URL", "agentpay-preview.vercel.app");
    expect(trustedOrigin(new Request("https://untrusted-host.example"))).toBe(
      "https://agentpay.example",
    );
  });
  it("rejects malformed platform hostnames instead of trusting request Host", () => {
    vi.stubEnv("APP_ORIGIN", "");
    for (const host of [
      "https://evil.example",
      "user@evil.example",
      "preview.vercel.app/path",
      "preview.vercel.app:443",
    ]) {
      vi.stubEnv("VERCEL_URL", host);
      expect(() =>
        trustedOrigin(new Request("https://evil.example")),
      ).toThrow();
    }
  });
});
