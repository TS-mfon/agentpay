"use client";
import { useState, type FormEvent } from "react";
import Icon from "./Icon";
import Dialog from "./Dialog";
import { formatMoney, shorten } from "./view-model";
import type { Service } from "./types";
export interface RequestInput {
  recipient: string;
  amount: string;
  service: string;
  purpose: string;
  evidence: string;
  idempotencyKey: string;
}
export default function RequestComposer({
  services,
  disabled,
  busy,
  mode,
  onRequest,
}: {
  services: Service[];
  disabled: boolean;
  busy: boolean;
  mode: "demo" | "live";
  onRequest: (input: RequestInput) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Service | null>(null);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState("");
  function choose(service: Service) {
    setSelected(service);
    setAmount(service.amount);
    setPurpose(service.purpose);
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setError("");
    if (!/^\d+(?:\.\d{1,6})?$/.test(amount) || /^0+(?:\.0+)?$/.test(amount)) {
      setError("Enter a positive amount with up to six decimal places.");
      return;
    }
    try {
      await onRequest({
        recipient: selected.recipient,
        amount,
        service: selected.name,
        purpose,
        evidence: selected.evidence,
        idempotencyKey: crypto.randomUUID(),
      });
      setSelected(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The payment request failed.",
      );
    }
  }
  return (
    <section className="service-section" aria-labelledby="services-title">
      <div className="section-heading">
        <div>
          <span className="section-label">Agent workspace</span>
          <h2 id="services-title">Discover a service. Request a payment.</h2>
        </div>
        <span className="subtle-label">
          {mode === "demo" ? "Sample services" : "Service catalog"}
        </span>
      </div>
      <p className="section-description">
        The research agent can request a service. Its mandate decides what it
        can buy.
      </p>
      <div className="service-list">
        {services.map((service, index) => (
          <article className="service-item" key={service.id}>
            <div className={`service-icon service-icon-${index % 3}`}>
              <Icon
                name={index === 0 ? "search" : index === 1 ? "grid" : "play"}
                size={22}
              />
            </div>
            <div className="service-copy">
              <h3>{service.name}</h3>
              <p>{service.description}</p>
              <span className="recipient-label">
                Recipient {shorten(service.recipient)}
              </span>
            </div>
            <div className="service-price">
              <strong>
                {formatMoney(service.amount)} <small>tUSD8</small>
              </strong>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled || busy}
                onClick={() => choose(service)}
              >
                Request payment <Icon name="arrow" size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {disabled ? (
        <p className="control-note">
          Requests are stopped. Resume the treasury and authorize the agent to
          continue.
        </p>
      ) : null}
      {selected ? (
        <Dialog
          title="Request service payment"
          onClose={() => setSelected(null)}
        >
          <form className="stack-form" onSubmit={submit}>
            <div className="request-service">
              <Icon name="send" />
              <div>
                <strong>{selected.name}</strong>
                <span>{selected.description}</span>
              </div>
            </div>
            <label>
              Amount in tUSD8
              <input
                autoFocus
                required
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,6})?"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Why the agent needs this service
              <textarea
                required
                minLength={10}
                maxLength={1000}
                rows={3}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </label>
            <div className="evidence-summary">
              <span>Supporting evidence</span>
              <p>{selected.evidence || "No supporting evidence supplied."}</p>
            </div>
            <p className="muted">
              {mode === "demo"
                ? "This demo evaluates a sample policy and simulates settlement. It does not move testnet funds."
                : "The request will be evaluated by GenLayer. A finalized approval is required before Aevum settlement."}
            </p>
            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? "Requesting…" : "Submit payment request"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </section>
  );
}
