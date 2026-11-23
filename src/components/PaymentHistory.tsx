"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import Dialog from "./Dialog";
import {
  formatMoney,
  formatDate,
  shorten,
  statusLabel,
  paymentStage,
} from "./view-model";
import type { Payment } from "./types";
const stages = [
  "Request received",
  "Policy checks",
  "Authorization",
  "Payment execution",
  "Receipt recorded",
];
export default function PaymentHistory({
  payments,
  mode,
  busy,
  onProcess,
  initialSelectedId,
  treasuryId,
}: {
  payments: Payment[];
  mode: "demo" | "live";
  busy: boolean;
  onProcess: () => Promise<void>;
  initialSelectedId?: string;
  treasuryId?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const selected = payments.find((payment) => payment.id === selectedId);
  const pending = payments.some((payment) =>
    [
      "queued",
      "evaluating",
      "awaiting_finality",
      "approved",
      "executing",
    ].includes(payment.status),
  );
  return (
    <section className="panel payment-panel" aria-labelledby="history-title">
      <div className="panel-heading">
        <div>
          <span className="section-label">Payment ledger</span>
          <h2 id="history-title">Every request has a record.</h2>
        </div>
        {pending && mode === "demo" ? (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void onProcess()}
          >
            <Icon name="refresh" size={16} />
            {busy
              ? "Processing…"
              : mode === "demo"
                ? "Process queued requests"
                : "Run executor"}
          </button>
        ) : (
          <span className="subtle-label">
            {pending
              ? "Awaiting hosted executor"
              : `${payments.length} requests`}
          </span>
        )}
      </div>
      {payments.length ? (
        <div className="payment-table-wrap">
          <table className="payment-table">
            <thead>
              <tr>
                <th scope="col">Service / request</th>
                <th scope="col">Amount</th>
                <th scope="col">Decision</th>
                <th scope="col">Requested</th>
                <th scope="col" aria-label="View request" />
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <th scope="row">
                    <strong>{payment.service}</strong>
                    <span>
                      {shorten(payment.id)} · Mandate v{payment.policyVersion}
                    </span>
                  </th>
                  <td className="amount-cell">
                    {formatMoney(payment.amount)} <small>tUSD8</small>
                  </td>
                  <td>
                    <span className={`status status-${payment.status}`}>
                      {statusLabel(payment.status)}
                    </span>
                  </td>
                  <td className="date-cell">{formatDate(payment.createdAt)}</td>
                  <td>
                    <button
                      className="text-button"
                      aria-label={`View ${payment.service} request`}
                      onClick={() => setSelectedId(payment.id)}
                    >
                      View <Icon name="arrow" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-ledger">
          <span>
            <Icon name="clock" size={26} />
          </span>
          <h3>Your first payment starts with a request.</h3>
          <p>
            Submit a payment from the console. Its decision and receipt will appear here.
          </p>
          <Link className="text-button" href={treasuryId ? `/console?treasuryId=${encodeURIComponent(treasuryId)}` : "/console"}>Open payment console</Link>
        </div>
      )}
      {selected ? (
        <Dialog
          title="Payment request record"
          onClose={() => setSelectedId(null)}
        >
          <div className="receipt-heading">
            <div>
              <span>{selected.service}</span>
              <strong>
                {formatMoney(selected.amount)} <small>tUSD8</small>
              </strong>
            </div>
            <span className={`status status-${selected.status}`}>
              {statusLabel(selected.status)}
            </span>
          </div>
          <ol className="payment-timeline">
            {stages.map((stage, index) => {
              const complete =
                selected.status === "settled"
                  ? index <= paymentStage(selected.status)
                  : index < paymentStage(selected.status);
              return (
                <li key={stage} className={complete ? "completed" : ""}>
                  <span className="timeline-mark">
                    {complete ? <Icon name="check" size={13} /> : index + 1}
                  </span>
                  <span>{stage}</span>
                  {index === 2 && mode === "demo" ? (
                    <small>Simulated evaluation</small>
                  ) : null}
                  {index === 4 &&
                  selected.status === "settled" &&
                  mode === "demo" ? (
                    <small>Simulated receipt</small>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div className="decision-explanation">
            <span>Decision explanation</span>
            <p>
              {selected.decisionReason ||
                selected.error ||
                "The request is waiting for evaluation. A payment will only execute after a finalized approval."}
            </p>
          </div>
          <dl className="receipt-details">
            <div>
              <dt>Payment purpose</dt>
              <dd>{selected.purpose}</dd>
            </div>
            <div>
              <dt>Policy version</dt>
              <dd>Version {selected.policyVersion}</dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd className="break-address">{selected.recipient}</dd>
            </div>
            <div>
              <dt>Request reference</dt>
              <dd className="break-address">{selected.id}</dd>
            </div>
            {selected.decisionRef ? (
              <div>
                <dt>Decision reference</dt>
                <dd className="break-address">{selected.decisionRef}</dd>
              </div>
            ) : null}
            <div>
              <dt>Settlement</dt>
              <dd>
                {mode === "demo" ? (
                  "Demo simulation. No on-chain transaction."
                ) : selected.transactionHash &&
                  /^0x[0-9a-fA-F]{64}$/.test(selected.transactionHash) ? (
                  <a
                    className="receipt-link"
                    href={`https://explorer-test.qday.info/tx/${selected.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View Aevum transaction <Icon name="external" size={14} />
                  </a>
                ) : (
                  "No confirmed Aevum transaction yet."
                )}
              </dd>
            </div>
          </dl>
          <div className="dialog-actions">
            <button
              className="secondary-button"
              onClick={() => setSelectedId(null)}
            >
              Close record
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
