import { describe, it, expect, vi, afterEach } from "vitest";
import { governanceChain } from "../../src/integrations/genlayer-network";
afterEach(() => vi.unstubAllEnvs());
describe("explicit governance network identity", () => {
  it("uses canonical Studio-dev for Studio Next", () => {
    vi.stubEnv("GENLAYER_NETWORK", "studio-next");
    expect(governanceChain().id).toBe(61997);
    expect(governanceChain().rpcUrls.default.http[0]).toBe(
      "https://studio-dev.genlayer.com/api",
    );
  });
  it("does not substitute stable Studionet for Studio-dev", () => {
    vi.stubEnv("GENLAYER_NETWORK", "studionet");
    expect(governanceChain().id).toBe(61999);
  });
  it("rejects unknown aliases", () => {
    vi.stubEnv("GENLAYER_NETWORK", "invented-network");
    expect(governanceChain).toThrow();
  });
});
