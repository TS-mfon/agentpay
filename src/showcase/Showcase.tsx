"use client";
import { useCallback, useEffect, useState } from "react";
import { formatMoney, shorten, statusLabel } from "../components/view-model";
import type { PaymentStatus } from "../components/types";
import "./showcase.css";
type Proof = {
  mode: "live";
  treasuryId: string;
  agentName: string;
  balance: string;
  paused: boolean;
  active: boolean;
  policy: {
    version: number;
    mandate: string;
    mandateHash: string;
    perPaymentLimit: string;
    weeklyBudget: string;
    totalBudget: string;
    validUntil: number;
  };
  payments: {
    id: string;
    service: string;
    amount: string;
    recipient: string;
    status: PaymentStatus;
    createdAt: string;
    policyVersion: number;
    decisionReason?: string;
    decisionRef?: string;
    transactionHash?: string;
    requestHash: string;
  }[];
};
export default function Showcase() {
  const [data, setData] = useState<Proof | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/showcase", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success)
        throw new Error(
          body.error?.message || "Live proof is temporarily unavailable.",
        );
      setData(body.data);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load live evidence.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  const paid = data?.payments.some((p) => p.status === "settled");
  return (
    <main className="proof-shell">
      <header className="proof-header">
        <a href="/" className="proof-brand">
          <img src="/icon.svg" alt="" width="34" height="34" />
          AgentPay
        </a>
        <span className="proof-network">Live Aevum Testnet</span>
        <a href="/">Owner workspace</a>
      </header>
      <section className="proof-intro">
        <h1>
          {paid
            ? "An agent paid for research. You can verify it."
            : "Follow a governed agent payment."}
        </h1>
        <p>
          A financial mandate evaluated on GenLayer Studio Next, with hard
          spending limits and tUSD8 settlement on QDay Aevum.
        </p>
        <button disabled={busy} onClick={() => void refresh()}>
          {busy ? "Refreshing evidence…" : "Refresh evidence"}
        </button>
      </section>
      {error ? (
        <p className="proof-error" role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <p role="status">Loading live evidence…</p> : null}
      {data ? (
        <>
          <section className="proof-account" aria-label="Live treasury">
            <div>
              <span>Agent</span>
              <strong>{data.agentName}</strong>
            </div>
            <div>
              <span>Treasury balance</span>
              <strong>{formatMoney(data.balance)} tUSD8</strong>
            </div>
            <div>
              <span>Per-payment cap</span>
              <strong>{formatMoney(data.policy.perPaymentLimit)} tUSD8</strong>
            </div>
            <div>
              <span>Weekly budget</span>
              <strong>{formatMoney(data.policy.weeklyBudget)} tUSD8</strong>
            </div>
          </section>
          <section className="proof-mandate">
            <div className="proof-section-title">
              <h2>The owner’s mandate</h2>
              <span>Version {data.policy.version}</span>
            </div>
            <blockquote>{data.policy.mandate}</blockquote>
            <details>
              <summary>Inspect policy and vault references</summary>
              <dl>
                <div>
                  <dt>Mandate hash</dt>
                  <dd>{data.policy.mandateHash}</dd>
                </div>
                <div>
                  <dt>Vault on Aevum</dt>
                  <dd>
                    <a
                      href={`https://explorer-test.qday.info/address/${data.treasuryId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {data.treasuryId}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Expiry</dt>
                  <dd>
                    {new Date(data.policy.validUntil * 1000).toLocaleString()}
                  </dd>
                </div>
              </dl>
            </details>
          </section>
          <section className="proof-payments">
            <h2>Requests, decisions and settlement</h2>
            {data.payments.length ? (
              data.payments.map((payment) => (
                <article className="proof-payment" key={payment.id}>
                  <div className="proof-payment-heading">
                    <div>
                      <h3>{payment.service}</h3>
                      <span>Mandate v{payment.policyVersion}</span>
                    </div>
                    <strong>{formatMoney(payment.amount)} tUSD8</strong>
                    <span className={`proof-status proof-${payment.status}`}>
                      {statusLabel(payment.status)}
                    </span>
                  </div>
                  <p className="proof-reason">
                    {payment.decisionReason ||
                      "Waiting for a finalized policy decision."}
                  </p>
                  <dl>
                    <div>
                      <dt>Request</dt>
                      <dd title={payment.id}>{shorten(payment.id)}</dd>
                    </div>
                    <div>
                      <dt>Recipient</dt>
                      <dd>{payment.recipient}</dd>
                    </div>
                    {payment.decisionRef ? (
                      <div>
                        <dt>GenLayer decision</dt>
                        <dd>{payment.decisionRef}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Aevum settlement</dt>
                      <dd>
                        {payment.transactionHash ? (
                          <a
                            href={`https://explorer-test.qday.info/tx/${payment.transactionHash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Verify transaction{" "}
                            {shorten(payment.transactionHash)}
                          </a>
                        ) : payment.status === "rejected" ? (
                          "Rejected; no payment executed."
                        ) : (
                          "Awaiting settlement."
                        )}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))
            ) : (
              <p>No payment evidence has been recorded yet.</p>
            )}
          </section>
          <aside className="proof-trust">
            <h2>What this evidence proves</h2>
            <p>
              The transaction links prove actual Aevum testnet settlement. The
              treasury contract independently enforces budgets, recipients,
              expiry and replay protection. A trusted executor verifies the
              finalized GenLayer judgment before submitting the payment.
            </p>
            <p>
              Studio Next is a hosted development environment with temporary
              state. Cross-chain policy approval is attested by the executor;
              Aevum does not cryptographically verify GenLayer consensus.
            </p>
          </aside>
        </>
      ) : null}
      <footer className="proof-footer">
        <a
          href="https://github.com/TS-mfon/agentpay"
          target="_blank"
          rel="noreferrer"
        >
          Open-source code
        </a>
        <a href="/demo.webm">Prototype walkthrough (simulated)</a>
        <a
          href="https://explorer-studio-dev.genlayer.com"
          target="_blank"
          rel="noreferrer"
        >
          Studio Next explorer
        </a>
      </footer>
    </main>
  );
}
