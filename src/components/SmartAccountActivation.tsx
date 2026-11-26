import type { SmartAccountPreview } from "./smart-wallet";

export default function SmartAccountActivation({ preview, busy, onActivate, onCancel }: {
  preview: SmartAccountPreview;
  busy: boolean;
  onActivate: () => Promise<void>;
  onCancel: () => void;
}) {
  return <div className="smart-account-preview">
    <dl><dt>Smart account address</dt><dd className="break-address">{preview.address}</dd></dl>
    {preview.deployed ? <p>Sign in with the browser wallet that controls this Aevum smart account.</p> : <>
      <p>Send tQDAY to this address on Aevum Testnet to pay for activation and treasury controls.</p>
      <a href="https://faucet.qday.info/en" target="_blank" rel="noreferrer">Get testnet tQDAY</a>
    </>}
    <p>Gas balance {preview.gasBalance} tQDAY</p>
    <div className="welcome-wallet-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={() => void onActivate()}>
        {busy ? "Waiting for confirmation…" : preview.deployed ? "Sign in to smart account" : "Activate smart account"}
      </button>
      <button type="button" className="text-button" disabled={busy} onClick={onCancel}>Back</button>
    </div>
  </div>;
}
