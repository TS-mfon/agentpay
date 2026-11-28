"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Circle, Minus } from "lucide-react";
import { ApiError } from "@/components/api";
import { scanIdPattern, type ScanPaymentDetail } from "@/core/scan-types";
import type { PaymentStatus, PaymentVerdict } from "@/core/types";
import { ScanAmount, ScanBadge, ScanRequestId, ScanTime } from "./ScanParts";
import { isActiveStatus, scanPayment, scanStatusLabels, useScanPolling } from "./scan-client";

const progressMessages: Record<PaymentStatus, string> = {
  queued: "Waiting for executor",
  evaluating: "GenLayer reviewing",
  awaiting_finality: "Awaiting finality",
  approved: "Awaiting payment on Aevum",
  executing: "Awaiting payment on Aevum",
  settled: "Settlement recorded",
  rejected: "GenLayer rejected this request",
  needs_information: "GenLayer needs more evidence",
  expired: "Payment authorization expired",
  failed: "Payment processing stopped",
};

const stoppedStages = {
  validation: "Payment validation failed",
  governance: "GenLayer review stopped",
  settlement: "Aevum settlement stopped",
};

type Step = { name: string; note: string; state: "done" | "current" | "stopped" | "waiting" };

function reviewStep(payment: ScanPaymentDetail): Step {
  const name = "GenLayer review";
  const verdict = payment.governance?.verdict;
  if (verdict) return { name, note: scanStatusLabels[verdict], state: verdict === "approved" ? "done" : "stopped" };
  if (payment.status === "evaluating" || payment.status === "awaiting_finality")
    return { name, note: progressMessages[payment.status], state: "current" };
  if (payment.status === "failed" && payment.failureStage === "governance")
    return { name, note: "Review stopped", state: "stopped" };
  return isActiveStatus(payment.status)
    ? { name, note: "Awaiting review", state: "waiting" }
    : { name, note: "Verdict unavailable", state: "stopped" };
}

function settlementStep(payment: ScanPaymentDetail): Step {
  const name = "Aevum settlement";
  if (payment.status === "settled") {
    return { name, note: payment.transactionHash ? "Transfer verified" : "Settlement recorded", state: "done" };
  }
  if (payment.status === "approved" || payment.status === "executing")
    return { name, note: "Awaiting payment", state: "current" };
  if (payment.status === "failed" && payment.failureStage === "settlement")
    return { name, note: "Settlement stopped", state: "stopped" };
  if (payment.status === "expired" && payment.governance?.verdict === "approved")
    return { name, note: "Authorization expired", state: "stopped" };
  return isActiveStatus(payment.status)
    ? { name, note: "Awaiting authorization", state: "waiting" }
    : { name, note: "Settlement skipped", state: "waiting" };
}

function ScanProgress({ payment }: { payment: ScanPaymentDetail }) {
  const steps: Step[] = [
    { name: "Request submitted", note: "Recorded", state: "done" },
    reviewStep(payment),
    settlementStep(payment),
  ];
  return (
    <section className="scan-progress" aria-labelledby="scan-progress-heading">
      <h2 id="scan-progress-heading">Request progress</h2>
      <ol>
        {steps.map(({ name, note, state }) => (
          <li key={name} className={"scan-step scan-step-" + state} aria-current={state === "current" ? "step" : undefined}>
            <span className="scan-step-mark" aria-hidden="true">
              {state === "done" ? <Check size={16} /> : state === "stopped" ? <Minus size={15} /> : <Circle size={10} />}
            </span>
            <div><strong>{name}</strong><span>{note}</span></div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function decisionLabel(verdict?: PaymentVerdict) {
  return verdict ? scanStatusLabels[verdict] : "Verdict unavailable";
}

function PaymentDetail({ payment, demo, retry }: { payment: ScanPaymentDetail; demo: boolean; retry: () => void }) {
  const note = payment.status === "failed" && payment.failureStage
    ? stoppedStages[payment.failureStage]
    : progressMessages[payment.status];
  const transactionHash = payment.status === "settled" && payment.transactionHash && scanIdPattern.test(payment.transactionHash)
    ? payment.transactionHash : undefined;

  return (
    <article className="scan-card scan-detail-card">
      <div className="scan-card-header">
        <h1>{payment.agentName}</h1>
        <ScanBadge status={payment.status} />
      </div>
      <ScanAmount amount={payment.amount} />
      <p className="scan-detail-state" role="status">{note}</p>

      <div className="scan-detail-meta">
        <div><span>Submitted</span><ScanTime value={payment.createdAt} /></div>
        {payment.expiresAt &&
          <div><span>Expired</span><ScanTime value={payment.expiresAt} /></div>}
        <div className="scan-detail-id"><span>Request ID</span><ScanRequestId id={payment.id} full /></div>
      </div>

      <ScanProgress payment={payment} />
      <section className="scan-decision" aria-labelledby="scan-decision-heading">
        <h2 id="scan-decision-heading">GenLayer decision</h2>
        <p>{payment.governance?.explanation ?? (
          payment.governance ? decisionLabel(payment.governance.verdict) :
            isActiveStatus(payment.status) ? "Awaiting finalized verdict" : decisionLabel()
        )}</p>
      </section>

      {transactionHash && <a
        href={"https://explorer-test.qday.info/tx/" + transactionHash}
        target="_blank" rel="noreferrer"
        className="scan-button scan-receipt-link"
      >
        View payment on Aevum <ArrowUpRight size={18} aria-hidden="true" />
      </a>}
      {payment.status === "settled" && !transactionHash && !demo &&
        <p className="scan-detail-link-note">
          Verified receipt unavailable. <button type="button" onClick={retry}>Check receipt again</button>
        </p>}
    </article>
  );
}

export default function ScanDetail({ id, demo }: { id: string | null; demo: boolean }) {
  const [payment, setPayment] = useState<ScanPaymentDetail | null>(null);
  const [problem, setProblem] = useState<"missing" | "failed" | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = () => {
    setProblem(null);
    setRevision((previous) => previous + 1);
  };

  const load = useCallback(async (signal: AbortSignal) => {
    if (!id) return;
    try {
      const result = await scanPayment(id, signal);
      if (signal.aborted) return;
      setPayment(result);
      setProblem(null);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError && error.status === 404) {
        setPayment(null);
        setProblem("missing");
        return;
      }
      setProblem("failed");
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [id, load, revision]);

  useScanPolling(Boolean(payment && isActiveStatus(payment.status)), load);

  return (
    <div className="scan-detail">
      <Link href="/scan" className="scan-back"><ArrowLeft size={18} aria-hidden="true" /> Back to Scan</Link>
      {!id ? <div className="scan-empty">
        <h1>Invalid request ID</h1><p>Copy the full AgentPay request ID and try again.</p>
      </div> : problem === "missing" ? <div className="scan-empty">
        <h1>Request not found</h1><p>Check the request ID and try again.</p>
      </div> : !payment && problem === "failed" ? <div className="scan-empty" role="alert">
        <h1>Couldn’t load this request</h1><button type="button" className="scan-refresh" onClick={retry}>Try again</button>
      </div> : !payment ? <p className="scan-empty" role="status">Loading request…</p> : (
        <>
          <PaymentDetail payment={payment} demo={demo} retry={retry} />
          {problem && <p className="scan-feedback" role="status">Couldn’t refresh this request. <button type="button" onClick={retry}>Try again</button></p>}
        </>
      )}
    </div>
  );
}
