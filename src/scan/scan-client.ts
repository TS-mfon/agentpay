"use client";

import { useEffect } from "react";
import { api } from "@/components/api";
import {
  scanIdPattern,
  type ScanFilter,
  type ScanPaymentDetail,
  type ScanPaymentPage,
} from "@/core/scan-types";
import type { PaymentStatus } from "@/core/types";

export function normalizeScanId(value: string) {
  const id = value.trim();
  return scanIdPattern.test(id) ? id.toLowerCase() : null;
}

export const scanStatusLabels: Record<ScanFilter, string> = {
  pending: "Pending",
  approved: "Approved",
  settled: "Settled",
  needs_information: "Needs evidence",
  rejected: "Rejected",
  expired: "Expired",
  failed: "Failed",
};

export function statusGroup(status: PaymentStatus): ScanFilter {
  if (status === "queued" || status === "evaluating" || status === "awaiting_finality") return "pending";
  return status === "executing" ? "approved" : status;
}

export function inFilter(status: PaymentStatus, filter: ScanFilter | "all") {
  return filter === "all" || statusGroup(status) === filter;
}

export function isActiveStatus(status: PaymentStatus) {
  const group = statusGroup(status);
  return group === "pending" || group === "approved";
}

const timing = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
});

export function formatScanTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "Unknown time" : timing.format(parsed) + " UTC";
}

export function scanIdLabel(id: string) {
  return id.slice(0, 8) + "…" + id.slice(-6);
}

export function scanFeed(
  query: { filter?: ScanFilter | "all"; cursor?: string; ids?: string[] },
  signal: AbortSignal,
) {
  const params = new URLSearchParams();
  if (query.filter && query.filter !== "all") params.set("status", query.filter);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.ids) params.set("ids", query.ids.join(","));
  const search = params.toString();
  return api<ScanPaymentPage>("/api/scan/payments" + (search ? "?" + search : ""), undefined, {
    credentials: "omit", signal,
  });
}

export function scanPayment(id: string, signal: AbortSignal) {
  return api<ScanPaymentDetail>("/api/scan/payments/" + id, undefined, { credentials: "omit", signal });
}

export const filterChoices = Object.keys(scanStatusLabels) as ScanFilter[];

export function useScanPolling(active: boolean, refresh: (signal: AbortSignal) => Promise<void>) {
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let inFlight = false;
    async function tick() {
      if (document.hidden || inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        await refresh(controller.signal);
      } finally {
        inFlight = false;
      }
    }

    const timer = window.setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      controller.abort();
    };
  }, [active, refresh]);
}
