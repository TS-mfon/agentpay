"use client";
import { useState, type FormEvent } from "react";
import Dialog from "./Dialog";
import Icon from "./Icon";
import { formatMoney, shorten } from "./view-model";
import type { Policy } from "./types";
export default function MandatePanel({
  policy,
  busy,
  onSave,
}: {
  policy: Policy;
  busy: boolean;
  onSave: (policy: Omit<Policy, "version" | "mandateHash">) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    mandate: policy.mandate,
    perPaymentLimit: policy.perPaymentLimit,
    weeklyBudget: policy.weeklyBudget,
    totalBudget: policy.totalBudget,
    recipients: policy.recipients.join("\n"),
  });
  const [error, setError] = useState("");
  const open = () => {
    setForm({
      mandate: policy.mandate,
      perPaymentLimit: policy.perPaymentLimit,
      weeklyBudget: policy.weeklyBudget,
      totalBudget: policy.totalBudget,
      recipients: policy.recipients.join("\n"),
    });
    setError("");
    setEditing(true);
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const recipients = form.recipients.split(/[\s,]+/).filter(Boolean);
    if (
      !recipients.length ||
      recipients.some((value) => !/^0x[0-9a-fA-F]{40}$/.test(value))
    ) {
      setError("Enter at least one valid recipient address.");
      return;
    }
    try {
      await onSave({ ...form, recipients, validUntil: policy.validUntil });
      setEditing(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The mandate could not be saved.",
      );
    }
  }
  return (
    <section className="panel mandate-panel" aria-labelledby="mandate-title">
      <div className="panel-heading">
        <div>
          <span className="section-label">Spending authority</span>
          <h2 id="mandate-title">The agent&apos;s mandate</h2>
        </div>
        <span className="version">Version {policy.version}</span>
      </div>
      <blockquote>{policy.mandate}</blockquote>
      <div className="mandate-limits">
        <div>
          <span>Per payment</span>
          <strong>
            {formatMoney(policy.perPaymentLimit)} <small>tUSD8</small>
          </strong>
        </div>
        <div>
          <span>Weekly budget</span>
          <strong>
            {formatMoney(policy.weeklyBudget)} <small>tUSD8</small>
          </strong>
        </div>
        <div>
          <span>Approved recipients</span>
          <strong>
            {policy.recipients.length} <small>addresses</small>
          </strong>
        </div>
      </div>
      <div className="panel-footer">
        <span>
          <Icon name="shield" size={16} /> Hard limits apply to every payment.
        </span>
        <button className="text-button" onClick={open} disabled={busy}>
          Edit mandate
        </button>
      </div>
      {editing ? (
        <Dialog title="Edit spending mandate" onClose={() => setEditing(false)}>
          <form className="stack-form" onSubmit={save}>
            <p className="muted">
              This creates a new policy version. Previous decisions keep their
              original mandate. Pending approvals must be evaluated again.
            </p>
            <label>
              Financial mandate
              <textarea
                required
                minLength={20}
                maxLength={4000}
                rows={5}
                value={form.mandate}
                onChange={(e) => setForm({ ...form, mandate: e.target.value })}
              />
            </label>
            <div className="form-columns">
              <label>
                Maximum per payment
                <input
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,6})?"
                  value={form.perPaymentLimit}
                  onChange={(e) =>
                    setForm({ ...form, perPaymentLimit: e.target.value })
                  }
                />
              </label>
              <label>
                Weekly budget
                <input
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,6})?"
                  value={form.weeklyBudget}
                  onChange={(e) =>
                    setForm({ ...form, weeklyBudget: e.target.value })
                  }
                />
              </label>
              <label>
                Lifetime budget
                <input
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,6})?"
                  value={form.totalBudget}
                  onChange={(e) =>
                    setForm({ ...form, totalBudget: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Approved recipient addresses
              <textarea
                required
                rows={3}
                value={form.recipients}
                onChange={(e) =>
                  setForm({ ...form, recipients: e.target.value })
                }
              />
              <small>One address per line.</small>
            </label>
            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? "Saving mandate…" : "Save new mandate"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
      <span className="sr-only">
        Mandate hash {shorten(policy.mandateHash)}
      </span>
    </section>
  );
}
