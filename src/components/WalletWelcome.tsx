import Link from "next/link";
import Icon from "./Icon";
import type { SmartAccountPreview } from "./smart-wallet";

export default function WalletWelcome({ busy, onConnect, onPreview, onActivate, onCancel, preview }: {
  busy: boolean;
  onConnect: () => Promise<void>;
  onPreview?: () => Promise<void>;
  onActivate: () => Promise<void>;
  onCancel: () => void;
  preview: SmartAccountPreview | null;
}) {
  return <section className="welcome-flow" aria-labelledby="welcome-title">
    <div className="welcome-art" aria-hidden="true"><span className="welcome-vault"><Icon name="shield" size={72}/></span><span className="welcome-orbit"><Icon name="key" size={25}/></span><span className="welcome-orbit welcome-orbit-two"><Icon name="wallet" size={26}/></span></div>
    <div className="welcome-content">
      <h2 id="welcome-title">Start with your wallet.</h2>
      {preview ? <div className="smart-account-preview">
        <dl><dt>Smart account address</dt><dd className="break-address">{preview.address}</dd></dl>
        {preview.deployed ? <p>Sign in with the browser wallet that controls this Aevum smart account.</p> : <>
          <p>Send tQDAY to this address on Aevum Testnet to pay for activation and treasury controls.</p>
          <a href="https://faucet.qday.info/en" target="_blank" rel="noreferrer">Get testnet tQDAY</a>
        </>}
        <p>Gas balance {preview.gasBalance} tQDAY</p>
        <div className="welcome-wallet-actions">
          <button className="primary-button" disabled={busy} onClick={() => void onActivate()}>{busy ? "Waiting for confirmation…" : preview.deployed ? "Sign in to smart account" : "Activate smart account"}</button>
          <button className="text-button" disabled={busy} onClick={onCancel}>Back</button>
        </div>
      </div> : <>
        <p>Connect your owner wallet, approve any Aevum Testnet prompts, then sign a one-time message.</p>
        <ol className="welcome-steps"><li>Connect your wallet</li><li>Create an agent treasury</li><li>Fund and connect your agent</li></ol>
        <div className="welcome-wallet-actions">
          <button className="primary-button" disabled={busy} onClick={() => void onConnect()}><Icon name="wallet" size={18}/>{busy ? "Waiting for wallet…" : "Connect wallet"}</button>
          {onPreview ? <button className="secondary-button" disabled={busy} onClick={() => void onPreview()}>Create smart account</button> : null}
        </div>
        <p className="welcome-note">You keep custody. AgentPay never asks for your private key.</p>
        <Link className="text-button" href="/docs#owner-setup">Aevum wallet setup guide</Link>
      </>}
    </div>
  </section>;
}
