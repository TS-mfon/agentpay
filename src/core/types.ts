export const TUSD8_ADDRESS = "0x456569838f1d43009A91ebA4263147Afd7233483" as const;
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
export type Mode = "demo" | "live";
export interface Policy {
  treasuryId: string;
  agentId: string;
  version: number;
  mandate: string;
  mandateHash: string;
  perPaymentLimit: string;
  weeklyBudget: string;
  totalBudget: string;
  validUntil: number;
  recipients: string[];
}
export interface Treasury {
  id: string;
  owner: string;
  executor: string;
  token: string;
  agentId: string;
  agentName: string;
  balance: string;
  reservedBalance?: string;
  availableBalance?: string;
  availableWeeklyBudget?: string;
  availableTotalBudget?: string;
  spendableBalance?: string;
  paused: boolean;
  active: boolean;
  policyVersion: number;
  keyVersion: number;
  weeklySpent: string;
  totalSpent: string;
  week: number;
}
export interface PaymentInput {
  recipient: string;
  amount: string;
  service: string;
  purpose: string;
  evidence: string;
  idempotencyKey: string;
}
export interface Payment extends PaymentInput {
  id: string;
  treasuryId: string;
  agentId: string;
  policyVersion: number;
  mandateHash: string;
  amountUnits: string;
  requestHash: string;
  createdAt: string;
  expiresAt: string;
  status: PaymentStatus;
  attempts: number;
  leaseUntil?: number;
  retryAt?: number;
  consecutiveFailures?: number;
  lastAttemptAt?: number;
  governanceUnresolved?: boolean;
  rawGovernanceTransaction?: string;
  policyRegistration?: { reference: string; rawTransaction: string };
  decisionRef?: string;
  evaluationReferences?: string[];
  evaluationRecoveryAttempts?: number;
  decisionReason?: string;
  approvalExpiresAt?: number;
  transactionHash?: string;
  rawTransaction?: string;
  error?: string;
}
export interface Credential {
  digest: string;
  treasuryId: string;
  agentId: string;
  keyVersion: number;
  expiresAt: number;
}
export interface Nonce {
  value: string;
  owner: string;
  message: string;
  expiresAt: number;
}
export interface Session {
  digest: string;
  owner: string;
  expiresAt: number;
}
export interface RateWindow {
  key: string;
  start: number;
  count: number;
}
export interface State {
  revision: number;
  workerLease?: { token: string; expiresAt: number };
  executorWakeAfter?: number;
  treasuries: Treasury[];
  policies: Policy[];
  payments: Payment[];
  credentials: Credential[];
  nonces: Nonce[];
  sessions: Session[];
  rateWindows: RateWindow[];
}
export interface ServiceItem {
  id: string;
  name: string;
  description: string;
  recipient: string;
  amount: string;
  purpose: string;
  evidence: string;
}
export interface Dashboard {
  mode: Mode;
  owner: string;
  treasury: Treasury | null;
  policy: Policy | null;
  payments: Payment[];
  services: ServiceItem[];
}
export const emptyState = (): State => ({
  revision: 0,
  treasuries: [],
  policies: [],
  payments: [],
  credentials: [],
  nonces: [],
  sessions: [],
  rateWindows: [],
});
