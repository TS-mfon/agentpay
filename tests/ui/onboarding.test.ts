import { describe, expect, it } from "vitest";
import { emptySetup, parseRecipients, validateSetupStep, buildSetupInput } from "../../src/components/onboarding";

const recipient = "0x2222222222222222222222222222222222222222";
const valid = { ...emptySetup, agentName: "Market researcher", mandate: "Pay approved research APIs for relevant market datasets only.", recipients: recipient };

describe("guided treasury onboarding", () => {
  it("begins without an invented agent, mandate or recipient", () => {
    expect(emptySetup.agentName).toBe("");
    expect(emptySetup.mandate).toBe("");
    expect(emptySetup.recipients).toBe("");
  });
  it("requires a meaningful agent identity before continuing", () => {
    expect(validateSetupStep(0, emptySetup, true)).toContain("agent name");
    expect(validateSetupStep(0, { ...valid, agentName: "   " }, true)).not.toBeNull();
    expect(validateSetupStep(0, { ...valid, agentName: "a".repeat(81) }, true)).not.toBeNull();
    expect(validateSetupStep(0, valid, true)).toBeNull();
  });
  it("requires an explicit mandate and positive finite six-decimal budgets", () => {
    expect(validateSetupStep(1, { ...valid, mandate: "short" }, true)).toContain("mandate");
    for (const value of ["0", "-1", "NaN", "1.0000001", "1e3", "01", "10000000000000"]) {
      expect(validateSetupStep(1, { ...valid, perPaymentLimit: value }, true)).not.toBeNull();
    }
    expect(validateSetupStep(1, { ...valid, perPaymentLimit: "0.000001" }, true)).toBeNull();
  });
  it("checks budget ordering with exact token units", () => {
    expect(validateSetupStep(1, { ...valid, perPaymentLimit: "40.000001" }, true)).toContain("Weekly");
    expect(validateSetupStep(1, { ...valid, weeklyBudget: "200.000001" }, true)).toContain("Lifetime");
    expect(validateSetupStep(1, { ...valid, perPaymentLimit: "40", weeklyBudget: "40", totalBudget: "40" }, true)).toBeNull();
  });
  it("requires recipients and rejects zero or malformed addresses", () => {
    expect(validateSetupStep(2, { ...valid, recipients: "" }, true)).toContain("recipient");
    expect(validateSetupStep(2, { ...valid, recipients: "0xwrong" }, true)).not.toBeNull();
    expect(validateSetupStep(2, { ...valid, recipients: "0x" + "0".repeat(40) }, true)).not.toBeNull();
  });
  it("deduplicates recipients and bounds the allowlist", () => {
    expect(parseRecipients(recipient + ",\n" + recipient)).toEqual([recipient]);
    expect(() => parseRecipients(Array.from({ length: 31 }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0")).join("\n"))).toThrow("30");
  });
  it("requires an existing vault address when resuming configuration", () => {
    expect(validateSetupStep(2, valid, false)).toContain("vault address");
    expect(validateSetupStep(2, { ...valid, treasuryId: recipient }, false)).toBeNull();
  });
  it("requires an explicit finite authorization lifetime", () => {
    for (const expiryDays of ["0", "-1", "91", "1.5", "NaN"]) {
      expect(validateSetupStep(2, { ...valid, expiryDays }, true)).toContain("expiry");
    }
    expect(validateSetupStep(2, { ...valid, expiryDays: "1" }, true)).toBeNull();
  });
  it("revalidates every earlier step before authorizing any deployment", () => {
    expect(validateSetupStep(3, emptySetup, true)).toContain("agent name");
    expect(validateSetupStep(3, valid, true)).toBeNull();
    expect(() => buildSetupInput(emptySetup, true, 100)).toThrow();
  });
  it("builds a trimmed request with no UI-only fields or mutated input", () => {
    const source = { ...valid, agentName: "  Market researcher  ", mandate: "  " + valid.mandate + "  ", recipients: recipient + "," + recipient };
    const request = buildSetupInput(source, true, 1000);
    expect(request.agentName).toBe("Market researcher");
    expect(request.mandate).toBe(valid.mandate);
    expect(request.validUntil).toBe(1000 + 30 * 86400);
    expect(request.recipients).toEqual([recipient]);
    expect(request).not.toHaveProperty("expiryDays");
    expect(source.agentName).toBe("  Market researcher  ");
  });
});
