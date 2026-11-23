import type { State, Payment, Policy, Treasury } from "./types";
export interface AtomicStore {
  read(): Promise<State>;
  update(transform: (state: State) => State): Promise<State>;
}
export interface PolicyDecision {
  finalized: boolean;
  status:
    "pending" | "approved" | "rejected" | "needs_information" | "unavailable";
  reason: string;
  requestHash: string;
  mandateHash: string;
}
export interface VaultSnapshot {
  owner: string;
  executor: string;
  token: string;
  balance: string;
  paused: boolean;
  active: boolean;
  policyVersion: number;
  mandateHash: string;
  perPaymentLimit: string;
  weeklyBudget: string;
  totalBudget: string;
  validUntil: number;
  recipients?: string[];
  weeklySpent: string;
  totalSpent: string;
  week?: number;
}
export interface Governance {
  register(policy: Policy): Promise<void>;
  submit(policy: Policy, payment: Payment): Promise<string>;
  inspect(reference: string, payment: Payment): Promise<PolicyDecision>;
}
export interface Settlement {
  snapshot(treasury: Treasury, recipients?: string[]): Promise<VaultSnapshot>;
  prepare(
    treasury: Treasury,
    payment: Payment,
  ): Promise<{ hash: string; rawTransaction: string }>;
  broadcast(rawTransaction: string): Promise<string>;
  reconcile(payment: Payment): Promise<{
    status: "settled" | "pending" | "not_found" | "failed";
    transactionHash?: string;
  }>;
}
export interface Ports {
  governance: Governance;
  settlement: Settlement;
  now?: () => number;
  services?: import("./types").ServiceItem[];
}
