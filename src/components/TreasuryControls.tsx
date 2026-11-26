"use client";
import { useState, type FormEvent } from "react";
import Icon from "./Icon";
import Dialog from "./Dialog";
import { api } from "./api";
import { scopedPath } from "./workspace-model";
import { formatMoney, shorten } from "./view-model";
import type { Credential, DashboardData, OwnerAction } from "./types";
export default function TreasuryControls({
  data,
  busy,
  onControl,
  onRefresh,
  onRenew,
}: {
  data: DashboardData;
  busy: boolean;
  onControl: (action: OwnerAction, amount?: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onRenew?: () => void;
}) {
  const expired = data.policy.validUntil * 1000 <= Date.now();
  const [dialog, setDialog] = useState<
    "fund" | "withdraw" | "key" | "revoke" | null
  >(null);
  const [amount, setAmount] = useState("10");
  const [error, setError] = useState("");
  const [key, setKey] = useState<Credential | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  function open(value: typeof dialog) {
    setDialog(value);
    setError("");
    setAmount("10");
    setKey(null);
    setCopied(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (dialog === "fund" || dialog === "withdraw")
        await onControl(dialog, amount);
      else if (dialog === "revoke") await onControl("revoke");
      setDialog(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The control change failed.",
      );
    }
  }
  async function directControl(action: OwnerAction) {
    setError("");
    try {
      await onControl(action);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The control change failed.",
      );
    }
  }
  async function issueKey() {
    setKeyBusy(true);
    setError("");
    try {
      setKey(
        await api<Credential>(scopedPath("/api/owner/credentials", data.treasury.id), { action: "rotate" }),
      );
      await onRefresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The key could not be issued.",
      );
    } finally {
      setKeyBusy(false);
    }
  }
  async function copyKey() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key.key);
      setCopied(true);
    } catch {
      setError(
        "Clipboard access is unavailable. Select and copy the key manually.",
      );
    }
  }
  return (
    <section className="owner-controls" aria-labelledby="controls-title">
      <div className="section-heading">
        <div>
          <span className="section-label">Owner controls</span>
          <h2 id="controls-title">You keep authority over the funds.</h2>
        </div>
        <span className="subtle-label">{shorten(data.treasury.id)}</span>
      </div>
      <div className="controls-row">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => open("fund")}
        >
          <Icon name="plus" size={17} /> Add funds
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => open("withdraw")}
        >
          <Icon name="wallet" size={17} /> Withdraw unused funds
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            data.treasury.paused && expired ? onRenew?.() : void directControl(data.treasury.paused ? "resume" : "pause")
          }
        >
          <Icon name={data.treasury.paused ? "play" : "pause"} size={17} />
          {data.treasury.paused ? expired ? "Renew before resuming" : "Resume treasury" : "Pause treasury"}
        </button>
        <button
          className="secondary-button"
          disabled={busy || keyBusy || expired || !data.treasury.active}
          onClick={() => open("key")}
        >
          <Icon name="key" size={17} /> Agent API key
        </button>
        <button
          className="text-button danger-text"
          disabled={busy}
          onClick={() =>
            expired
              ? onRenew?.()
              : data.treasury.active
              ? open("revoke")
              : void directControl("reactivate")
          }
        >
          {expired ? "Renew agent authority" : data.treasury.active ? "Revoke agent" : "Authorize agent again"}
        </button>
      </div>
      {error && !dialog ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="muted">
        Unused funds remain yours to withdraw, including while the treasury is
        paused.
      </p>
      {dialog ? (
        <Dialog
          title={
            dialog === "fund"
              ? "Add treasury funds"
              : dialog === "withdraw"
                ? "Withdraw unused funds"
                : dialog === "revoke"
                  ? "Revoke agent authority"
                  : "Agent API credential"
          }
          onClose={() => setDialog(null)}
        >
          {dialog === "key" ? (
            <div className="stack-form">
              <p className="muted">
                Issue a new key for this agent&apos;s payment API. Rotating the
                key invalidates its previous credential.
              </p>
              {key ? (
                <>
                  <label>
                    Copy this key now
                    <textarea
                      readOnly
                      rows={3}
                      value={key.key}
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                  <p className="key-warning">
                    Keep this key private. It is shown only for this session.
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => void copyKey()}
                  >
                    {copied ? "Key copied" : "Copy agent key"}
                  </button>
                </>
              ) : (
                <button
                  className="primary-button"
                  disabled={busy || keyBusy}
                  onClick={() => void issueKey()}
                >
                  {keyBusy ? "Issuing key…" : "Rotate and reveal new key"}
                </button>
              )}
              {error ? (
                <p role="alert" className="form-error">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <form className="stack-form" onSubmit={submit}>
              {dialog === "revoke" ? (
                <p>
                  Revoking the agent stops new requests and prevents pending
                  approvals from being executed. You can authorize it again with
                  a new policy version.
                </p>
              ) : (
                <>
                  <p className="muted">
                    {data.mode === "demo"
                      ? "This changes the simulated treasury balance. No tokens move on Aevum."
                      : dialog === "fund"
                        ? data.ownerAccountType === "smart"
                          ? "Load your smart account with tUSD8 before funding this vault. Your smart account pays tQDAY for gas."
                          : "Your wallet will transfer tUSD8 to the treasury on Aevum Testnet."
                        : data.ownerAccountType === "smart"
                          ? "Unused tUSD8 goes back to your smart account."
                          : "Your wallet will withdraw available tUSD8 to the treasury owner's address."}
                  </p>
                  {data.ownerAccountType === "smart" ? <code className="break-address">{data.treasury.owner}</code> : null}
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
                  <p className="muted">
                    Available balance: {formatMoney(data.treasury.balance)}{" "}
                    tUSD8
                  </p>
                </>
              )}
              {error ? (
                <p role="alert" className="form-error">
                  {error}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </button>
                <button
                  className={
                    dialog === "revoke" ? "danger-button" : "primary-button"
                  }
                  disabled={busy}
                >
                  {busy
                    ? "Confirming…"
                    : dialog === "fund"
                      ? "Add funds"
                      : dialog === "withdraw"
                        ? "Withdraw funds"
                        : "Revoke agent"}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      ) : null}
    </section>
  );
}
