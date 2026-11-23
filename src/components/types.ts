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
