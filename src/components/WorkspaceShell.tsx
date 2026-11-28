import Link from "next/link";
import Icon from "./Icon";
import { shorten } from "./view-model";
import type { ReactNode } from "react";
import type { WorkspaceView } from "./types";
const navigation=[
  ["agents","/agents","grid","Agents"],
  ["console","/console","send","Payment console"],
  ["history","/history","clock","Request history"],
  ["setup","/setup","plus","Create agent"],
] as const;
export default function WorkspaceShell({view,owner,mode,busy,treasuryId,onConnect,onDisconnect,children}:{
  view:WorkspaceView;owner:string;mode:"demo"|"live";busy:boolean;treasuryId?:string;
  onConnect:()=>Promise<void>;onDisconnect:()=>Promise<void>;children:ReactNode;
}) {
 const current=treasuryId ? `?treasuryId=${encodeURIComponent(treasuryId)}` : "";
 const title=view==="agent"?"Agent treasury":navigation.find(item=>item[0]===view)?.[3]??"Agents";
 return <div className="app-shell">
  <a href="#workspace" className="skip-link">Skip to workspace</a>
  <aside className="sidebar"><Link className="brand" href="/" aria-label="AgentPay home"><img src="/icon.svg" width="36" height="36" alt=""/><span>AgentPay</span></Link>
   <p className="sidebar-subtitle">Financial authority,<br/>on your terms.</p>
   <nav aria-label="Workspace navigation">{navigation.map(([name,path,icon,label])=><Link key={name} className={`nav-item ${view===name || name==="agents" && view==="agent"?"nav-active":""}`} aria-current={view===name || name==="agents" && view==="agent"?"page":undefined} href={path+(name==="console"||name==="history"?current:"")}><Icon name={icon}/>{label}</Link>)}<Link className="nav-item" href="/scan"><Icon name="search"/>Scan</Link><Link className="nav-item" href="/docs"><Icon name="external"/>Documentation</Link><Link className="nav-item" href="/"><Icon name="arrow"/>Back to home</Link></nav>
   <div className="sidebar-bottom"><div className="network-dot"/><div><strong>QDay Aevum</strong><span>{mode==="demo"?"Isolated test environment":"Testnet · chain 44005"}</span></div></div>
  </aside>
  <div className="main-shell"><header className="topbar"><span className="breadcrumb">AgentPay <span>/</span>{title}</span><div className="topbar-actions"><span className="environment-badge"><span/>{mode==="demo"?"Demo · simulated":"Aevum Testnet"}</span><Link className="workspace-docs-link" href="/docs">Docs</Link>{mode==="live" ? owner ? <><span className="wallet-button" title={owner}><Icon name="wallet" size={17}/>{shorten(owner)}</span><button className="text-button signout-button" disabled={busy} onClick={()=>void onDisconnect()}>Sign out</button></> : <button className="wallet-button wallet-connect" disabled={busy} onClick={()=>void onConnect()}><Icon name="wallet" size={17}/>{busy?"Connecting…":"Connect wallet"}</button> : null}</div></header>
   <main id="workspace" className="workspace">{children}<footer className="workspace-footer"><span>AgentPay</span><p>Intelligent mandates. Enforced budgets. Inspectable payments.</p><a href="https://explorer-test.qday.info/" target="_blank" rel="noreferrer">Aevum explorer <Icon name="external" size={13}/></a></footer></main>
  </div>
 </div>;
}
