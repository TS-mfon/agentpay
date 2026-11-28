import type {
  PaymentFailureStage,
  PaymentStatus,
  PaymentVerdict,
} from "./types";

export const scanIdPattern = /^0x[0-9a-f]{64}$/i;
export const scanPageSize = 24;

export const scanFilters = {
  pending: ["queued", "evaluating", "awaiting_finality"],
  needs_information: ["needs_information"],
  rejected: ["rejected"],
  approved: ["approved", "executing"],
  settled: ["settled"],
  expired: ["expired"],
  failed: ["failed"],
} as const satisfies Record<string, readonly PaymentStatus[]>;

export type ScanFilter = keyof typeof scanFilters;

export interface ScanPaymentSummary {
  id: string;
  agentName: string;
  amount: string;
  status: PaymentStatus;
  createdAt: string;
}

export interface ScanPaymentDetail extends ScanPaymentSummary {
  expiresAt?: string;
  governance?: { verdict: PaymentVerdict; explanation?: string };
  failureStage?: PaymentFailureStage;
  transactionHash?: string;
}

export interface ScanPaymentPage {
  items: ScanPaymentSummary[];
  nextCursor: string | null;
}
