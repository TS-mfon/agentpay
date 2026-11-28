export const fixtureAddress = "0x" + "2".repeat(40);
export const fixtureHash = "0x" + "c".repeat(64);
export const agentPaymentFixture = (id = "0x" + "b".repeat(64)) => ({
  id, treasuryId: fixtureAddress, agentId: fixtureHash, recipient: fixtureAddress,
  amount: "0.001", amountUnits: "1000", idempotencyKey: "water-test-001",
  policyVersion: 1, status: "queued", attempts: 0,
  createdAt: "2026-11-23T20:00:00.000Z", expiresAt: "2026-11-23T21:00:00.000Z",
});
export const paymentFixture = (id?: string) => ({
  ...agentPaymentFixture(id), service: "Water bill", purpose: "Pay household water bill",
  evidence: "Owner-requested test", mandateHash: fixtureHash, requestHash: fixtureHash,
});
