"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "./api";
import Icon from "./Icon";
import type { DashboardData } from "./types";
import type { OwnerOperationStatus } from "../core/owner-operations";
import {
  emptySetup, setupSteps, validateSetupStep, buildSetupInput,
  type SetupForm,
} from "./onboarding";

const stepCopy = [
  ["Meet your agent.", "Give it a name you will recognize in every payment record."],
  ["Define what it can spend on.", "Describe the work in plain English, then set limits that the vault will enforce."],
  ["Choose who it can pay.", "Only approved addresses can receive payments. You control the vault and can withdraw unused funds."],
  ["A final look before you create.", "Review your agent's authority. Your wallet confirms every on-chain setup transaction."],
] as const;

export default function SetupView({ onCreated, owner, smartAccount, busy, setBusy, pending, onOperation }: {
  onCreated: (data: DashboardData) => Promise<void>;
  owner: string;
  smartAccount: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  pending?: boolean;
  onOperation: (operation: OwnerOperationStatus | null) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [error, setError] = useState("");
  const [createNew, setCreateNew] = useState(true);
  const [progress, setProgress] = useState("");
  const [createdVault, setCreatedVault] = useState("");
  const [form, setForm] = useState<SetupForm>({ ...emptySetup });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, [step]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function update(field: keyof SetupForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }
  function moveTo(next: number) {
    setError("");
    setStep(next);
  }
  function continueSetup() {
    const failure = validateSetupStep(step, form, createNew);
    if (failure) { setError(failure); return; }
    const next = Math.min(step + 1, 3);
    setFurthestStep((current) => Math.max(current, next));
    moveTo(next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || pending) return;
    if (step < 3) { continueSetup(); return; }
    const failure = validateSetupStep(3, form, createNew);
    if (failure) { setError(failure); return; }
    setBusy(true);
    setError("");
    setProgress("");
    try {
      const input = buildSetupInput(form, createNew, Math.floor(Date.now() / 1000));
      const vaultCreated = (address: string) => {
        setForm((current) => ({ ...current, treasuryId: address }));
        setCreatedVault(address);
        setCreateNew(false);
      };
      if (smartAccount) {
        const { smartTreasurySetup } = await import("./smart-wallet");
        await onOperation(await smartTreasurySetup(input, owner, createNew, setProgress, vaultCreated));
        return;
      }
      const { prepareTreasury } = await import("./wallet");
      const treasuryId = await prepareTreasury(input, owner, createNew, setProgress, vaultCreated);
      setForm((current) => ({ ...current, treasuryId }));
      setCreateNew(false);
      setProgress("Registering the confirmed treasury and mandate…");
      const created = await api<DashboardData>("/api/owner/setup", { ...input, treasuryId });
      await onCreated(created);
    } catch (failure) {
      if (smartAccount) {
        const saved = await api<OwnerOperationStatus | null>("/api/owner/user-operations").catch(() => null);
        if (saved?.status === "pending") await onOperation(saved);
      }
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  const recipients = [...new Set(form.recipients.trim().split(/[\s,]+/).filter(Boolean))];
  return (
    <section className="setup-flow" aria-label="Create an agent treasury">
      <div className="setup-journey">
        <div className="journey-intro">
          <span className="setup-icon"><Icon name="shield" size={28} /></span>
          <h2>Give an agent<br />financial authority.</h2>
          <p>A funded vault. A clear mandate.<br />Your money stays under your control.</p>
        </div>
        <nav aria-label="Treasury setup progress">
          <ol className="setup-step-list">
            {setupSteps.map((label, index) => (
              <li key={label} className={index === step ? "step-current" : index < step ? "step-complete" : ""}>
                <button type="button" aria-current={index === step ? "step" : undefined}
                  disabled={busy || index > furthestStep} onClick={() => moveTo(index)}>
                  <span className="step-number">{index < step ? <Icon name="check" size={16} /> : index + 1}</span>
                  <span>{label}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <a className="journey-help" href="/docs#owner-setup"><Icon name="external" size={15} /> Read the setup guide</a>
      </div>
      <div className="setup-stage">
        <div className="setup-stage-heading">
          <span className="step-caption">Step {step + 1} of 4</span>
          <h2 ref={titleRef} tabIndex={-1}>{stepCopy[step][0]}</h2>
          <p>{stepCopy[step][1]}</p>
        </div>
        <form className="stack-form setup-form" onSubmit={submit} noValidate>
          <fieldset disabled={busy || pending} className="setup-fields" key={step}>
            {step === 0 ? (
              <>
                <label htmlFor="setup-agent-name">Agent name</label>
                <input id="setup-agent-name" name="agentName" required maxLength={80} value={form.agentName}
                  placeholder="Name your agent" autoComplete="off"
                  onChange={(event) => update("agentName", event.target.value)} aria-describedby="agent-name-help" />
                <p id="agent-name-help" className="field-help">This name identifies the agent in your treasury and audit history.</p>
                <div className="setup-explainer">
                  <Icon name="key" size={22} />
                  <div><strong>Permission to request. Never a wallet key.</strong>
                    <p>Your agent will use a scoped API credential. It cannot withdraw money or change its own rules.</p></div>
                </div>
              </>
            ) : step === 1 ? (
              <>
                <label htmlFor="setup-mandate">Spending mandate</label>
                <textarea id="setup-mandate" required minLength={20} maxLength={4000} rows={5} value={form.mandate}
                  placeholder="Describe which services your agent may pay for, what work they support, and what is prohibited."
                  onChange={(event) => update("mandate", event.target.value)} aria-describedby="mandate-help" />
                <p id="mandate-help" className="field-help">GenLayer evaluates each payment's purpose against these instructions.</p>
                <div className="form-columns setup-budgets">
                  <label>Per payment <span className="input-unit">tUSD8</span>
                    <input required inputMode="decimal" value={form.perPaymentLimit} onChange={(event) => update("perPaymentLimit", event.target.value)} />
                  </label>
                  <label>Weekly budget <span className="input-unit">tUSD8</span>
                    <input required inputMode="decimal" value={form.weeklyBudget} onChange={(event) => update("weeklyBudget", event.target.value)} />
                  </label>
                  <label>Lifetime budget <span className="input-unit">tUSD8</span>
                    <input required inputMode="decimal" value={form.totalBudget} onChange={(event) => update("totalBudget", event.target.value)} />
                  </label>
                </div>
                <p className="field-help">These are spending caps, not deposits. The contract enforces them independently of policy decisions.</p>
              </>
            ) : step === 2 ? (
              <>
                <label htmlFor="setup-recipients">Approved recipient addresses</label>
                <textarea id="setup-recipients" required rows={3} value={form.recipients} placeholder="Paste a service provider's wallet address"
                  onChange={(event) => update("recipients", event.target.value)} aria-describedby="recipients-help" />
                <p id="recipients-help" className="field-help">One address per line, up to 30. Verify each address with the service provider.</p>
                <label htmlFor="setup-expiry">Authorization expires after</label>
                <div className="expiry-input"><input id="setup-expiry" inputMode="numeric" value={form.expiryDays}
                  onChange={(event) => update("expiryDays", event.target.value)} /><span>days</span></div>
                <fieldset className="setup-options">
                  <legend>Where funds will be held</legend>
                  <label><input type="radio" name="setup-mode" checked={createNew} onChange={() => setCreateNew(true)} />Create a new Aevum vault</label>
                  <label><input type="radio" name="setup-mode" checked={!createNew} onChange={() => setCreateNew(false)} />Use an existing AgentPay vault</label>
                </fieldset>
                {!createNew ? (
                  <label>Aevum treasury vault address
                    <input required placeholder="0x…" value={form.treasuryId} onChange={(event) => update("treasuryId", event.target.value)} />
                    <small>{smartAccount ? "Your smart account must own this vault." : "The connected wallet must own this vault."} Its token and ownership are checked on-chain.</small>
                  </label>
                ) : null}
              </>
            ) : (
              <div className="setup-review">
                <div className="review-agent"><span className="agent-avatar"><Icon name="search" size={24} /></span>
                  <div><strong>{form.agentName.trim()}</strong><span>{createNew ? "New owner-controlled Aevum vault" : "Existing owner-controlled Aevum vault"}</span></div>
                  <button type="button" className="text-button" onClick={() => moveTo(0)}>Edit agent</button>
                </div>
                <div className="review-mandate"><span>Spending mandate</span><p>{form.mandate.trim()}</p>
                  <button type="button" className="text-button" onClick={() => moveTo(1)}>Edit rules</button></div>
                <dl className="review-limits">
                  <div><dt>Per payment</dt><dd>{form.perPaymentLimit} <small>tUSD8</small></dd></div>
                  <div><dt>Weekly budget</dt><dd>{form.weeklyBudget} <small>tUSD8</small></dd></div>
                  <div><dt>Lifetime budget</dt><dd>{form.totalBudget} <small>tUSD8</small></dd></div>
                </dl>
                <div className="review-permissions"><div><span>Approved recipients</span><strong>{recipients.length} {recipients.length === 1 ? "address" : "addresses"}</strong></div>
                  <div><span>Authority expires</span><strong>After {form.expiryDays} days</strong></div>
                  <button type="button" className="text-button" onClick={() => moveTo(2)}>Edit permissions</button></div>
                <ul className="review-addresses" aria-label="Recipient addresses to authorize">{recipients.map((address) => <li key={address}><a href={`https://explorer-test.qday.info/address/${address}`} target="_blank" rel="noreferrer">{address}<Icon name="external" size={12} /></a></li>)}</ul>
                {!createNew ? <p className="review-vault break-address">Vault: {form.treasuryId}</p> : null}
                <div className="setup-explainer"><Icon name="wallet" size={22} />
                  <div><strong>{createNew ? "Two wallet confirmations" : "One wallet confirmation"}</strong>
                    <p>{smartAccount ? createNew ? "Your browser wallet pays tQDAY to deploy the vault. Your smart account pays tQDAY to authorize the agent." : "Your smart account pays tQDAY to authorize the agent." : `${createNew ? "Create the vault, then authorize your agent. " : "Authorize the agent in your existing vault. "}You need tQDAY for gas. Fund with tUSD8 after setup.`}</p>
                    <a href="https://faucet.qday.info/en" target="_blank" rel="noreferrer">Get testnet tokens <Icon name="external" size={13} /></a></div>
                </div>
              </div>
            )}
          </fieldset>
          {createdVault && error ? <div className="vault-recovery"><Icon name="check" size={18} /><div>
            <strong>Your vault was created successfully.</strong><p>Continue using this address; your next attempt configures the existing vault.</p>
            <a className="break-address" href={`https://explorer-test.qday.info/address/${createdVault}`} target="_blank" rel="noreferrer">{createdVault}</a>
          </div></div> : null}
          {error ? <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}
          {progress ? <p role="status" aria-live="polite" className="setup-progress"><span className="loading-spinner" />{progress}</p> : null}
          <div className="setup-actions">
            {step > 0 ? <button type="button" className="secondary-button" disabled={busy} onClick={() => moveTo(step - 1)}>Back</button> : <a href="/" className="text-button">Back to home</a>}
            <button className="primary-button" disabled={busy || pending}>
              {busy ? "Waiting for confirmation…" : step < 3 ? "Continue" : createNew ? "Create and authorize treasury" : "Configure and register treasury"}
              {!busy ? <Icon name="arrow" size={18} /> : null}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
