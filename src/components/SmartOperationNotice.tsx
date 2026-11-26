import Link from "next/link";
import type { OwnerOperationStatus } from "../core/owner-operations";

const descriptions = {
  pending: "Waiting for QDay confirmation",
  confirmed: "Smart-account operation confirmed",
  failed: "Smart-account operation failed",
  review: "Smart-account operation needs review",
};

export default function SmartOperationNotice({ operation, busy, checkError, onCheck, onDismiss }: {
  operation: OwnerOperationStatus;
  busy: boolean;
  checkError: string;
  onCheck: (rebroadcast: boolean) => Promise<void>;
  onDismiss: () => void;
}) {
  const pending = operation.status === "pending";
  const error = operation.status === "failed" || operation.status === "review";
  return <section className={`alert smart-operation ${error ? "alert-error" : operation.status === "confirmed" ? "alert-success" : ""}`} aria-label="Smart-account operation">
    <div>
      <strong role="status">{descriptions[operation.status]}</strong>
      {operation.agentName ? <p>Agent setup for {operation.agentName}</p> : null}
      <div>UserOperation <code>{operation.userOperationHash}</code></div>
      {operation.error ? <p>{operation.error}</p> : null}
      {checkError ? <p role="alert">{checkError}</p> : null}
      {pending ? <p>Treasury actions become available when this operation is confirmed or fails.</p> : null}
      {operation.transactionHash ? <a className="text-button" href={`https://explorer-test.qday.info/tx/${operation.transactionHash}`} target="_blank" rel="noreferrer">View Aevum receipt</a> : null}
      <div className="welcome-wallet-actions">
        {pending ? <>
          <button className="secondary-button" disabled={busy} onClick={() => void onCheck(false)}>Check confirmation</button>
          <button className="text-button" disabled={busy} onClick={() => void onCheck(true)}>Resend signed operation</button>
        </> : <>
          {operation.status === "confirmed" && operation.action === "setup" ?
            <Link className="text-button" href={`/agent/${operation.treasuryId}`}>Open treasury</Link> : null}
          <button className="text-button" onClick={onDismiss}>Dismiss</button>
        </>}
      </div>
    </div>
  </section>;
}
