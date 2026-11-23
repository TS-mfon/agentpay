import { TUSD8_ADDRESS } from "../core/types";
import { hashText, decimal, units } from "../core/validation";
import { emptyState, type State, type ServiceItem } from "../core/types";
import type { Ports } from "../core/ports";
export const DEMO_OWNER = "0x1111111111111111111111111111111111111111";
export const DEMO_TREASURY = "0x3333333333333333333333333333333333333333";
export const DEMO_RECIPIENT = "0x2222222222222222222222222222222222222222";
export const serviceCatalog: ServiceItem[] = [
  {
    id: "research",
    name: "Research API",
    description: "Company intelligence and verified market datasets",
    recipient: DEMO_RECIPIENT,
    amount: "4",
    purpose: "Market research data for the research agent",
    evidence:
      "Research dataset subscription for company intelligence; delivered as JSON.",
  },
  {
    id: "compute",
    name: "Analysis compute",
    description: "Run the data-processing task for a market study",
    recipient: DEMO_RECIPIENT,
    amount: "6",
    purpose: "Compute to analyze approved market research datasets",
    evidence: "Two hours of dataset processing for the market research task.",
  },
  {
    id: "unrelated",
    name: "Gaming subscription",
    description: "A service outside this agent’s financial mandate",
    recipient: DEMO_RECIPIENT,
    amount: "3",
    purpose: "Purchase a game entertainment subscription",
    evidence: "Entertainment membership invoice.",
  },
];
export function demoState(now = Date.now()): State {
  const id = hashText("agentpay-demo-research");
  const mandate =
    "You are a market research agent. Spend only on approved research APIs, datasets, and compute used for market research. Do not pay for entertainment or unrelated services. Maximum 10 tUSD8 per payment and 40 tUSD8 each week. Only approved recipients.";
  return {
    ...emptyState(),
    treasuries: [
      {
        id: DEMO_TREASURY,
        owner: DEMO_OWNER,
        executor: "0x4444444444444444444444444444444444444444",
        token: TUSD8_ADDRESS,
        agentId: id,
        agentName: "Research scout",
        balance: "100",
        paused: false,
        active: true,
        policyVersion: 1,
        keyVersion: 1,
        weeklySpent: "0",
        totalSpent: "0",
        week: Math.floor(now / 604800000),
      },
    ],
    policies: [
      {
        treasuryId: DEMO_TREASURY,
        agentId: id,
        version: 1,
        mandate,
        mandateHash: hashText(mandate),
        perPaymentLimit: "10",
        weeklyBudget: "40",
        totalBudget: "100",
        validUntil: Math.floor(now / 1000) + 2592000,
        recipients: [DEMO_RECIPIENT],
      },
    ],
  };
}
export function demoPorts(): Ports {
  return {
    services: serviceCatalog,
    governance: {
      async register() {},
      async submit(_policy, payment) {
        return "simulation:" + payment.id;
      },
      async inspect(_reference, payment) {
        const text = [payment.service, payment.purpose, payment.evidence]
          .join(" ")
          .toLowerCase();
        const unrelated = /game|gaming|entertainment|casino|unrelated/.test(
          text,
        );
        const relevant = /research|dataset|market|compute|analysis/.test(text);
        const insufficient = payment.evidence.trim().length < 10;
        return {
          finalized: true,
          status: unrelated
            ? "rejected"
            : insufficient
              ? "needs_information"
              : relevant
                ? "approved"
                : "needs_information",
          reason: unrelated
            ? "Simulation: entertainment does not serve the research mandate."
            : insufficient
              ? "Simulation: provide invoice details or supporting evidence."
              : relevant
                ? "Simulation: this research service supports the agent’s market research mandate."
                : "Simulation: service relevance is unclear; provide supporting information.",
          requestHash: payment.requestHash,
          mandateHash: payment.mandateHash,
        };
      },
    },
    settlement: {
      async snapshot() {
        throw new Error("Demo snapshots use local state");
      },
      async prepare(_treasury, payment) {
        return {
          hash: "simulation:" + payment.id,
          rawTransaction: "simulation:" + payment.id,
        };
      },
      async broadcast(raw) {
        return raw;
      },
      async reconcile() {
        return { status: "settled" };
      },
    },
  };
}
