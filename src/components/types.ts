export type PaymentStatus =
  | "queued"
  | "evaluating"
  | "awaiting_finality"
  | "approved"
  | "rejected"
  | "needs_information"
  | "executing"
  | "settled"
  | "expired"
  | "failed";
export interface Treasury {
  id: string;
  agentId: string;
  agentName: string;
  owner: string;
  executor: string;
  token: string;
  balance: string;
  availableBalance?: string;
  reservedBalance?: string;
  availableWeeklyBudget?: string;
  availableTotalBudget?: string;
  spendableBalance?: string;
  paused: boolean;
  active: boolean;
  policyVersion: number;
  keyVersion: number;
  weeklySpent: string;
  totalSpent: string;
}
export interface Policy {
  version: number;
  mandate: string;
  mandateHash: string;
  perPaymentLimit: string;
  weeklyBudget: string;
  totalBudget: string;
  validUntil: number;
  recipients: string[];
}
export interface Payment {
  id: string;
  service: string;
  purpose: string;
  evidence: string;
  recipient: string;
  amount: string;
  status: PaymentStatus;
  createdAt: string;
  expiresAt: string;
  policyVersion: number;
  decisionReason?: string;
  decisionRef?: string;
  transactionHash?: string;
  error?: string;
}
export interface Service {
  id: string;
  name: string;
  description: string;
  recipient: string;
  amount: string;
  purpose: string;
  evidence: string;
}
export interface DashboardData {
  mode: "demo" | "live";
  owner: string;
  ownerAccountType?: "wallet" | "smart";
  treasury: Treasury;
  policy: Policy;
  payments: Payment[];
  services: Service[];
}
export type OwnerAction =
  "fund" | "withdraw" | "pause" | "resume" | "revoke" | "reactivate";
export interface Credential {
  key: string;
  agentId: string;
  treasuryId: string;
  keyVersion: number;
}

export interface AgentCard extends Treasury {
  perPaymentLimit: string;
  weeklyBudget: string;
  totalBudget: string;
  validUntil: number;
  mandateHash?: string;
  recipients?: string[];
}
export interface AgentsData {
  mode: "demo" | "live";
  owner: string;
  ownerAccountType?: "wallet" | "smart";
  ownerSigner?: string;
  agents: AgentCard[];
  unavailable?: UnavailableAgent[];
}
export type WorkspaceView = "agents" | "agent" | "setup" | "console" | "history";

export interface UnavailableAgent {
 id: string;
 agentId: string;
 agentName: string;
 code: string;
 message: string;
}
