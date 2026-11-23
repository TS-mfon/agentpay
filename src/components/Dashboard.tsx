"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import MandatePanel from "./MandatePanel";
import RequestComposer, { type RequestInput } from "./RequestComposer";
import PaymentHistory from "./PaymentHistory";
import TreasuryControls from "./TreasuryControls";
import SetupView from "./SetupView";
import { api, ApiError, errorMessage } from "./api";
import {
  budgetPercent,
  formatMoney,
  remainingBudget,
  shorten,
  policyPayload,
} from "./view-model";
import type { DashboardData, OwnerAction, Policy } from "./types";
type Payload = Omit<DashboardData, "treasury" | "policy"> & {
  treasury: DashboardData["treasury"] | null;
  policy: Policy | null;
};
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [mode, setMode] = useState<"demo" | "live">("live");
  const [owner, setOwner] = useState("");
  const fetching = useRef(false);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const payload = await api<Payload>("/api/owner/dashboard");
      setMode(payload.mode);
      setOwner(payload.owner);
      setLoginRequired(false);
      setSetupRequired(!payload.treasury || !payload.policy);
      if (payload.treasury && payload.policy)
        setData({
          ...payload,
          treasury: payload.treasury,
          policy: payload.policy,
        });
      else setData(null);
      setError("");
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        setLoginRequired(true);
        setSetupRequired(false);
        setOwner("");
        setData(null);
        setMode("live");
      } else setError(errorMessage(failure));
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const pending =
    data?.payments.some((payment) =>
      [
        "queued",
        "evaluating",
        "awaiting_finality",
        "approved",
        "executing",
      ].includes(payment.status),
    ) ?? false;
  useEffect(() => {
    if (!pending || busy) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [pending, busy, refresh]);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const { connectOwner } = await import("./wallet");
      await connectOwner();
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/logout", {});
      setData(null);
      setOwner("");
      setSetupRequired(false);
      setLoginRequired(true);
      setNotice("");
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(success);
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    } finally {
      setBusy(false);
    }
  }
  async function request(input: RequestInput) {
    await run(async () => {
      await api("/api/owner/payments", input);
      if (data?.mode === "demo") await api("/api/owner/process", {});
    }, "Payment request recorded. Open its record to inspect the decision.");
  }
  async function process() {
    try {
      await run(
        async () => {
          await api("/api/owner/process", {});
        },
        mode === "demo"
          ? "Queued requests processed in the demo."
          : "Execution requested. Finality and settlement may take time.",
      );
    } catch {
      /* The visible alert contains the actionable error. */
    }
  }
  async function control(action: OwnerAction, amount?: string) {
    if (action === "reactivate" && data) {
      await savePolicy(policyPayload(data.policy));
      return;
    }
    await run(
      async () => {
        let txHash: string | undefined;
        if (data?.mode === "live") {
          const { walletControl } = await import("./wallet");
          txHash = await walletControl(data, action, amount);
        }
        await api("/api/owner/controls", { action, amount, txHash });
      },
      action === "withdraw"
        ? "Unused funds withdrawn."
        : action === "fund"
          ? "Treasury funds added."
          : action === "pause"
            ? "Treasury paused. New execution is stopped."
            : action === "revoke"
              ? "Agent spending authority revoked."
              : "Treasury authorization updated.",
    );
  }
  async function savePolicy(policy: Omit<Policy, "version" | "mandateHash">) {
    const payload = policyPayload(policy);
    await run(async () => {
      let txHash: string | undefined;
      if (data?.mode === "live") {
        const { configurePolicy } = await import("./wallet");
        txHash = await configurePolicy(data, payload);
      }
      await api("/api/owner/policy", {
        ...payload,
        ...(txHash ? { txHash } : {}),
      });
    }, "New mandate version saved.");
  }
  const spent = data?.treasury.weeklySpent ?? "0";
  const budget = data?.policy.weeklyBudget ?? "0";
  const progress = budgetPercent(spent, budget);
  return (
    <div className="app-shell">
      <a href="#workspace" className="skip-link">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="AgentPay home">
          <img src="/icon.svg" width="36" height="36" alt="" />
          <span>AgentPay</span>
        </a>
        <p className="sidebar-subtitle">Financial authority,<br />on your terms.</p>
        <nav aria-label="Workspace navigation">
          <a className="nav-item nav-active" href="#workspace">
            <Icon name="grid" /> Treasury workspace
          </a>
          <a className="nav-item" href="#services-title">
            <Icon name="send" /> Service requests
          </a>
          <a className="nav-item" href="#history-title">
            <Icon name="clock" /> Payment records
          </a>
          <a className="nav-item" href="#controls-title">
            <Icon name="shield" /> Owner controls
          </a>
          <a className="nav-item" href="/docs"><Icon name="external" /> Documentation</a>
          <a className="nav-item" href="/"><Icon name="arrow" /> Back to home</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="network-dot" />
          <div>
            <strong>QDay Aevum</strong>
            <span>
              {mode === "demo" ? "Demo environment" : "Testnet · chain 44005"}
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <span>/</span> Agent treasury
          </span>
          <div className="topbar-actions">
            <span
              className={`environment-badge ${mode === "demo" ? "demo-badge" : "live-badge"}`}
            >
              <span />
              {mode === "demo" ? "Demo · simulated" : "Aevum Testnet"}
            </span>
            <a className="workspace-docs-link" href="/docs">Docs</a>
            {mode === "live" ? owner ? (
              <>
                <span className="wallet-button" title={owner}><Icon name="wallet" size={17} />{shorten(owner)}</span>
                <button className="text-button signout-button" disabled={busy} onClick={() => void disconnect()}>Sign out</button>
              </>
            ) : (
              <button className="wallet-button wallet-connect" disabled={busy} onClick={() => void connect()}>
                <Icon name="wallet" size={17} />{busy ? "Connecting…" : "Connect wallet"}
              </button>
            ) : null}
          </div>
        </header>
        <main id="workspace" className="workspace">
          <div className="workspace-heading">
            <div>
              <h1>{data ? "Your agent treasury." : setupRequired ? "Set up your agent." : "Put your agent to work."}</h1>
              <p>{data ? "A clear mandate. Enforced budgets. Every payment accounted for." : "Give it permission to pay for useful work, within your rules."}</p>
            </div>
            {data ? (
              <div className="agent-identity">
                <span className="agent-avatar">
                  <Icon name="search" size={23} />
                </span>
                <div>
                  <strong>{data.treasury.agentName}</strong>
                  <span>
                    <i
                      className={
                        data.treasury.active && !data.treasury.paused
                          ? "agent-active"
                          : "agent-stopped"
                      }
                    />
                    {data.treasury.paused
                      ? "Treasury paused"
                      : data.treasury.active
                        ? "Authorized agent"
                        : "Authority revoked"}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
          {mode === "demo" ? (
            <div className="demo-notice">
              <Icon name="shield" size={18} />
              <span>
                Explore a complete payment workflow with sample data. Policy
                decisions and payments are simulated.
              </span>
            </div>
          ) : (
            <div className="live-notice">
              <Icon name="shield" size={17} /><span>Payments require finalized approval and stay within your vault's spending limits.</span><a href="/docs#architecture">How authorization works</a>
            </div>
          )}
          {error ? (
            <div className="alert alert-error" role="alert">
              <span>{error}</span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Retry
              </button>
            </div>
          ) : null}
          {notice ? (
            <div className="alert alert-success" role="status">
              <Icon name="check" size={17} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : null}
          {loading ? (
            <div className="loading-workspace" role="status">
              <span className="loading-spinner" />
              Loading your treasury…
            </div>
          ) : loginRequired ? (
            <section className="welcome-flow" aria-labelledby="welcome-title">
              <div className="welcome-art" aria-hidden="true"><span className="welcome-vault"><Icon name="shield" size={72} /></span><span className="welcome-orbit"><Icon name="key" size={25} /></span><span className="welcome-orbit welcome-orbit-two"><Icon name="wallet" size={26} /></span></div>
              <div className="welcome-content">
                <h2 id="welcome-title">Start with your wallet.</h2>
                <p>Connect your owner wallet and sign a one-time message. Then create a treasury, define your agent's rules, and fund it with tUSD8.</p>
                <ol className="welcome-steps"><li>Connect your wallet</li><li>Set up your agent</li><li>Fund and connect it</li></ol>
                <button className="primary-button" disabled={busy} onClick={() => void connect()}><Icon name="wallet" size={18} />{busy ? "Waiting for wallet…" : "Connect wallet"}</button>
                <p className="welcome-note">You keep custody. AgentPay never asks for your private key.</p>
                <a className="text-button" href="/docs#owner-setup">New to Aevum? Read the setup guide</a>
              </div>
            </section>
          ) : setupRequired ? (
            <SetupView onCreated={refresh} />
          ) : data ? (
            <>
              <section
                className="treasury-summary"
                aria-label="Treasury balances"
              >
                <div className="balance-summary">
                  <div className="balance-label">
                    <Icon name="wallet" size={19} />
                    Treasury balance
                  </div>
                  <strong>
                    {formatMoney(data.treasury.balance)} <span>tUSD8</span>
                  </strong>
                  <span className="summary-note">
                    {data.mode === "demo"
                      ? "Simulated funds"
                      : "Funds held in your Aevum vault"}
                  </span>
                </div>
                <div className="budget-summary">
                  <div className="budget-label">
                    <span>Weekly authority remaining</span>
                    <span>
                      {formatMoney(spent)} / {formatMoney(budget)} tUSD8 spent
                    </span>
                  </div>
                  <strong>
                    {formatMoney(remainingBudget(budget, spent))}{" "}
                    <span>tUSD8</span>
                  </strong>
                  <div
                    className="budget-track"
                    role="progressbar"
                    aria-label="Weekly budget spent"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <span className="summary-note">
                    Budget counts settled payments. Unused funds stay in the
                    treasury.
                  </span>
                </div>
              </section>
              <div className="treasury-next-actions">
                <div><strong>{/^0+(?:\.0+)?$/.test(data.treasury.balance) ? "Fund your treasury to get started." : "Connect your agent to its treasury."}</strong><p>Use owner controls to add tUSD8 and issue a scoped API key. Follow the agent guide for your first request.</p></div>
                <a className="secondary-button" href="#controls-title"><Icon name="wallet" size={17} />Funding & API key</a>
                <a className="text-button" href="/docs#agent-guide">Agent guide <Icon name="arrow" size={16} /></a>
              </div>
              <MandatePanel
                policy={data.policy}
                busy={busy}
                onSave={savePolicy}
              />
              <RequestComposer
                services={data.services}
                disabled={!data.treasury.active || data.treasury.paused}
                busy={busy}
                mode={data.mode}
                onRequest={request}
              />
              <PaymentHistory
                payments={data.payments}
                mode={data.mode}
                busy={busy}
                onProcess={process}
              />
              <TreasuryControls
                data={data}
                busy={busy}
                onControl={(action, amount) => control(action, amount)}
                onRefresh={refresh}
              />
            </>
          ) : null}
          <footer className="workspace-footer">
            <span>AgentPay</span>
            <p>Intelligent mandates. Enforced budgets. Inspectable payments.</p>
            <a
              href="https://explorer-test.qday.info/"
              target="_blank"
              rel="noreferrer"
            >
              Aevum explorer <Icon name="external" size={13} />
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
