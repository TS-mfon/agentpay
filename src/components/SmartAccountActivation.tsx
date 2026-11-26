import type { SmartAccountPreview } from "./smart-wallet";

export default function SmartAccountActivation({ preview, busy, error, onActivate, onCancel }: {
  preview: SmartAccountPreview;
  busy: boolean;
  error: string;
  onActivate: () => Promise<void>;
  onCancel: () => void;
}) {
  return <div className="smart-account-preview">
    <p>Your browser wallet signs for this QDay account. Each address has its own agent treasuries.</p>
    <dl><dt>Smart account address</dt><dd className="break-address">{preview.address}</dd></dl>
    {!preview.deployed ? <p>Send tQDAY to this address on Aevum Testnet. It pays for activation and treasury controls. <a href="https://faucet.qday.info/en" target="_blank" rel="noreferrer">Get testnet tQDAY</a></p> : null}
    <p>Gas balance {preview.gasBalance} tQDAY</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="welcome-wallet-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={() => void onActivate()}>
        {busy ? "Waiting for confirmation…" : preview.deployed ? "Sign in to smart account" : "Activate smart account"}
      </button>
      <button type="button" className="text-button" disabled={busy} onClick={onCancel}>Back</button>
    </div>
  </div>;
}
