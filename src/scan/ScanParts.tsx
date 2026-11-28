"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { PaymentStatus } from "@/core/types";
import { formatScanTime, scanIdLabel, scanStatusLabels, statusGroup } from "./scan-client";

export function ScanBadge({ status }: { status: PaymentStatus }) {
  const group = statusGroup(status);
  return (
    <span className={"scan-status scan-status-" + group}>
      <span className="scan-status-dot" aria-hidden="true" />
      {scanStatusLabels[group]}
    </span>
  );
}

export function ScanAmount({ amount }: { amount: string }) {
  return <p className="scan-amount"><span>{amount}</span> <small>tUSD8</small></p>;
}

export function ScanTime({ value }: { value: string }) {
  return <time dateTime={value}>{formatScanTime(value)}</time>;
}

export function ScanRequestId({ id, full = false }: { id: string; full?: boolean }) {
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready");

  useEffect(() => {
    if (state === "ready") return;
    const timeout = window.setTimeout(() => setState("ready"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="scan-request-id">
      <code title={id}>{full ? id : scanIdLabel(id)}</code>
      <button type="button" className="scan-copy" aria-label="Copy request ID" onClick={copy}>
        {state === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        <span>{state === "copied" ? "Copied" : state === "failed" ? "Retry copy" : "Copy"}</span>
      </button>
      <span className="scan-sr-only" role="status">
        {state === "copied" ? "Request ID copied." : state === "failed" ? "The request ID could not be copied." : ""}
      </span>
    </div>
  );
}
