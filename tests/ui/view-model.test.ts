import { describe, expect, it } from "vitest";
import {
  formatMoney,
  budgetPercent,
  remainingBudget,
  paymentStage,
  statusLabel,
  policyPayload,
} from "../../src/components/view-model";

describe("payment presentation", () => {
  it("whitelists mandate fields without leaking runtime ownership metadata", () => {
    const source = {
      version: 2,
      mandateHash: "0xhash",
      treasuryId: "0xvault",
      agentId: "0xagent",
      mandate: "Research services only",
      perPaymentLimit: "10",
      weeklyBudget: "40",
      totalBudget: "100",
      validUntil: 2000000000,
      recipients: ["0xrecipient"],
    };
    const payload = policyPayload(source);
    expect(payload).toEqual({
      mandate: source.mandate,
      perPaymentLimit: "10",
      weeklyBudget: "40",
      totalBudget: "100",
      validUntil: 2000000000,
      recipients: ["0xrecipient"],
    });
    expect(payload.recipients).not.toBe(source.recipients);
    expect(Object.keys(payload)).not.toContain("treasuryId");
  });
  it("keeps six-decimal token precision without floating point", () => {
    expect(formatMoney("1.000001")).toBe("1.000001");
    expect(formatMoney("1200.5")).toBe("1,200.50");
    expect(formatMoney("0")).toBe("0.00");
  });
  it("rejects malformed amounts rather than presenting a false balance", () => {
    expect(formatMoney("not money")).toBe("Unavailable");
    expect(formatMoney("1.0000001")).toBe("Unavailable");
  });
  it("clamps budget percentage and treats no budget as unavailable", () => {
    expect(budgetPercent("10", "40")).toBe(25);
    expect(budgetPercent("50", "40")).toBe(100);
    expect(budgetPercent("0", "0")).toBe(0);
  });
  it("does not present negative remaining authority", () => {
    expect(remainingBudget("40", "12.123456")).toBe("27.876544");
    expect(remainingBudget("40", "50")).toBe("0");
  });
  it("never marks an unresolved or rejected request as settled", () => {
    expect(paymentStage("awaiting_finality")).toBe(2);
    expect(paymentStage("settled")).toBe(4);
    expect(paymentStage("rejected")).toBe(1);
    expect(statusLabel("needs_information")).toBe("Needs information");
  });
});
