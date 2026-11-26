import Link from "next/link";
import Icon from "./Icon";
import SmartAccountActivation from "./SmartAccountActivation";
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
      {preview ? <SmartAccountActivation preview={preview} busy={busy} onActivate={onActivate} onCancel={onCancel} /> : <>
        <p>Connect your owner wallet, approve any Aevum Testnet prompts, then sign a one-time message.</p>
        <ol className="welcome-steps"><li>Connect your wallet</li><li>Create an agent treasury</li><li>Fund and connect your agent</li></ol>
        <div className="welcome-wallet-actions">
          <button className="primary-button" disabled={busy} onClick={() => void onConnect()}><Icon name="wallet" size={18}/>{busy ? "Waiting for wallet…" : "Connect wallet"}</button>
          {onPreview ? <button className="secondary-button" disabled={busy} onClick={() => void onPreview()}>Create smart account</button> : null}
        </div>
        {onPreview ? <p className="welcome-note">A QDay smart account can own your vault and resume treasury spending in one transaction.</p> : null}
        <Link className="text-button" href="/docs#owner-setup">Aevum wallet setup guide</Link>
      </>}
    </div>
  </section>;
}
