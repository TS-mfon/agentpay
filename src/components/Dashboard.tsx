"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WorkspaceShell from "./WorkspaceShell";
import WalletWelcome from "./WalletWelcome";
import AgentsGrid from "./AgentsGrid";
import AgentOverview from "./AgentOverview";
import AgentSelector from "./AgentSelector";
import RequestComposer, { correctableRequestErrors, type RequestInput } from "./RequestComposer";
import PaymentHistory from "./PaymentHistory";
import SetupView from "./SetupView";
import SmartOperationNotice from "./SmartOperationNotice";
import Icon from "./Icon";
import useAgentWorkspace from "./useAgentWorkspace";
import { api, ApiError, errorMessage } from "./api";
import { scopedPath, spendableBalance } from "./workspace-model";
import { policyPayload } from "./view-model";
import type { DashboardData, OwnerAction, Policy, WorkspaceView } from "./types";
import type { OwnerOperationStatus } from "../core/owner-operations";
import type { SmartAccountPreview } from "./smart-wallet";

export default function Dashboard({view="agents",reference,requestId}:{view?:WorkspaceView;reference?:string;requestId?:string}){
 const router=useRouter();
 const state=useAgentWorkspace(view,reference);
 const {listing,data,loading,loginRequired,error,setError,refresh}=state;
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const [smartAccounts,setSmartAccounts]=useState(false);
 const [preview,setPreview]=useState<SmartAccountPreview|null>(null);
 const [operation,setOperation]=useState<OwnerOperationStatus|null>(null);
 const smartOwner=listing.ownerAccountType==="smart";
 const treasuryBusy=busy||operation?.status==="pending";
 useEffect(()=>setNotice(""),[view,reference]);
 useEffect(()=>{
  if(!loginRequired)return;
  let active=true;
  api<{mode:string;smartAccounts?:object}>("/api/config").then(config=>{
   if(active)setSmartAccounts(config.mode==="live"&&!!config.smartAccounts);
  }).catch(()=>{if(active)setSmartAccounts(false);});
  return()=>{active=false;};
 },[loginRequired]);
 const showOperation=useCallback(async(result:OwnerOperationStatus|null)=>{
  setOperation(result);
  if(!result||result.status==="pending")return;
  await refresh();
 },[refresh]);
 const registeredVault=operation?.status==="confirmed"&&operation.action==="setup"?operation.treasuryId:null;
 useEffect(()=>{
  if(!registeredVault||!listing.ownerSigner)return;
  const signer=listing.ownerSigner as `0x${string}`;
  import("./treasury-deployment").then(({clearSmartAccountVaultDeployment})=>
   clearSmartAccountVaultDeployment(signer,registeredVault as `0x${string}`)).catch(()=>{});
 },[registeredVault,listing.ownerSigner]);
 useEffect(()=>{
  if(!smartOwner){setOperation(null);return;}
  let active=true;
  api<OwnerOperationStatus|null>("/api/owner/user-operations").then(result=>{
   if(active)setOperation(current=>current??result);
  }).catch(()=>{});
  return()=>{active=false;};
 },[smartOwner,listing.owner]);
 const pendingHash=operation?.status==="pending"?operation.userOperationHash:null;
 useEffect(()=>{
  if(!smartOwner||!pendingHash||busy)return;
  let active=true;
  let timer:ReturnType<typeof setTimeout>;
  async function poll(){
   try{
    const {resumeOwnerOperation}=await import("./smart-wallet");
    const result=await resumeOwnerOperation(pendingHash!);
    if(active&&result)await showOperation(result);
    if(result&&result.status!=="pending")return;
   }catch{/* The receipt remains pending while the network is unavailable. */}
   if(active)timer=setTimeout(poll,5000);
  }
  timer=setTimeout(poll,2500);
  return()=>{active=false;clearTimeout(timer);};
 },[smartOwner,pendingHash,busy,showOperation]);
 async function connect(){
  setBusy(true);setError("");setNotice("");
  try{const {connectOwner}=await import("./wallet");await connectOwner();await refresh();}
  catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function switchNetwork(){
  setBusy(true);setError("");setNotice("");
  try{const {switchToAevum}=await import("./wallet");await switchToAevum();setNotice("Your wallet is on Aevum Testnet.");}
  catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function reviewSmartAccount(){
  setBusy(true);setError("");setNotice("");
  try{const {previewSmartAccount}=await import("./smart-wallet");setPreview(await previewSmartAccount());}
  catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function activate(){
  if(!preview)return;
  setBusy(true);setError("");
  try{const {activateSmartAccount}=await import("./smart-wallet");await activateSmartAccount(preview);setPreview(null);await refresh();}
  catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function checkOperation(rebroadcast:boolean){
  if(!pendingHash)return;
  setBusy(true);setError("");
  try{const {resumeOwnerOperation}=await import("./smart-wallet");await showOperation(await resumeOwnerOperation(pendingHash,rebroadcast));}
  catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function disconnect(){
  setBusy(true);setError("");
  try{await api("/api/auth/logout",{});setOperation(null);await refresh();setNotice("");}
  catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function run(action:()=>Promise<void>,success:string){
  setBusy(true);setError("");setNotice("");
  try{await action();await refresh();setNotice(success);}
  catch(failure){setError(errorMessage(failure));throw failure;}finally{setBusy(false);}
 }
 async function request(input:RequestInput){
  if(!data)throw new Error("Choose an owned agent before requesting a payment.");
  await run(async()=>{
   try {await api(scopedPath("/api/owner/payments",data.treasury.id),input);}
   catch(failure){if(failure instanceof ApiError && correctableRequestErrors.has(failure.code))await refresh();throw failure;}
   if(data.mode==="demo")await api("/api/owner/process",{});
  },"Your payment request is recorded. Follow its decision and settlement in history.");
 }
 async function process(){
  try{await run(async()=>{await api("/api/owner/process",{});},"Queued test requests processed.");}catch{/* Visible request alert supplies recovery. */}
 }
 async function savePolicy(policy:Omit<Policy,"version"|"mandateHash">){
  if(!data)throw new Error("Choose an owned agent before updating its mandate.");
  const payload=policyPayload(policy);
  if(smartOwner){await smartControl("policy",payload);return;}
  await run(async()=>{
   let txHash:string|undefined;
   if(data.mode==="live"){const {configurePolicy}=await import("./wallet");txHash=await configurePolicy(data,payload);}
   await api(scopedPath("/api/owner/policy",data.treasury.id),{...payload,...(txHash?{txHash}:{})});
  },"New mandate version saved for this agent.");
 }
 async function control(action:OwnerAction,amount?:string){
  if(!data)throw new Error("Choose an owned agent before managing funds.");
  if(smartOwner){await smartControl(action,policyPayload(data.policy),amount);return;}
  if(action==="reactivate"){await savePolicy(policyPayload(data.policy));return;}
  await run(async()=>{
   let txHash:string|undefined;
   if(data.mode==="live"){const {walletControl}=await import("./wallet");txHash=await walletControl(data,action,amount);}
   await api(scopedPath("/api/owner/controls",data.treasury.id),{action,amount,txHash});
  },action==="withdraw"?"Unused funds withdrawn.":action==="fund"?"Treasury funds added.":action==="pause"?"This treasury is paused. New execution is stopped.":action==="revoke"?"This agent's spending authority is revoked.":"Treasury authorization updated.");
 }
 async function smartControl(action:OwnerAction|"policy",policy:Omit<Policy,"version"|"mandateHash">,amount?:string){
  if(!data)return;
  setBusy(true);setError("");setNotice("");
  try{const {smartWalletControl}=await import("./smart-wallet");await showOperation(await smartWalletControl(data,action,policy,amount));}
  catch(failure){
   const saved=await api<OwnerOperationStatus|null>("/api/owner/user-operations").catch(()=>null);
   if(saved?.status==="pending")setOperation(saved);
   setError(errorMessage(failure));throw failure;
  }finally{setBusy(false);}
 }
 async function created(payload:DashboardData){
  if(!payload.treasury?.id)throw new Error("The treasury was created but its record was unavailable. Refresh your agents before retrying.");
  router.push(`/agent/${encodeURIComponent(payload.treasury.id)}`);
 }
 const unavailableAgent=listing.unavailable?.find(agent=>reference && (agent.id.toLowerCase()===reference.toLowerCase() || agent.agentId.toLowerCase()===reference.toLowerCase()));
 const selector=view==="console"||view==="history";
 return <WorkspaceShell view={view} owner={listing.owner} mode={listing.mode} busy={busy} treasuryId={data?.treasury.id} onConnect={connect} onDisconnect={disconnect} onSwitchNetwork={listing.mode==="live"&&(listing.owner||loginRequired)?switchNetwork:undefined}>
  {listing.unavailable?.length?<div className="alert alert-error" role="status"><span>{listing.unavailable.length} agent vault{listing.unavailable.length===1?"":"s"} could not be verified. Healthy agents remain available.</span><Link className="text-button" href="/agents">View agents</Link></div>:null}
  {error?<div className="alert alert-error" role="alert"><span>{error}</span><button className="text-button" disabled={busy} onClick={()=>void refresh()}>Retry</button></div>:null}
  {notice?<div className="alert alert-success" role="status"><Icon name="check" size={17}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setNotice("")}><Icon name="close" size={16}/></button></div>:null}
  {smartOwner&&operation?<SmartOperationNotice operation={operation} busy={busy} onCheck={checkOperation} onDismiss={()=>setOperation(null)}/>:null}
  {loading?<div className="loading-workspace" role="status"><span className="loading-spinner"/>Loading your agents…</div>:loginRequired?<WalletWelcome busy={busy} onConnect={connect} onPreview={smartAccounts?reviewSmartAccount:undefined} onActivate={activate} preview={preview} onCancel={()=>{setPreview(null);setError("");}}/>:error && !listing.owner?<section className="empty-agents"><h2>The workspace is unavailable.</h2><p>Your agents could not be loaded. Retry the connection before creating or paying from a treasury.</p><button className="primary-button" disabled={busy} onClick={()=>void refresh()}>Reload workspace</button></section>:view==="agents"?<AgentsGrid agents={listing.agents} unavailable={listing.unavailable}/>:view==="setup"?<>
   <div className="workspace-heading"><div><h1>Create an agent treasury.</h1><p>{smartOwner?"Your Aevum smart account will own this vault.":"A dedicated vault and a spending mandate, owned by your wallet."}</p></div><Link className="text-button" href="/agents">Back to agents</Link></div>
   <SetupView onCreated={created} owner={listing.owner} smartAccount={smartOwner} busy={busy} setBusy={setBusy} pending={operation?.status==="pending"} onOperation={showOperation}/>
  </>:<>
   {selector?<><div className="workspace-heading"><div><h1>{view==="console"?"Payment console.":"Request history."}</h1><p>{view==="console"?"Request a real governed payment for the selected agent.":"Inspect requests, policy decisions, and settlement receipts for one agent."}</p></div></div><AgentSelector agents={listing.agents} selectedId={data?.treasury.id} page={view}/></>:null}
   {data?view==="agent"?<AgentOverview data={data} busy={treasuryBusy} onControl={control} onSave={savePolicy} onRefresh={refresh}/>:view==="console"?<RequestComposer key={data.treasury.id} services={data.services} policy={data.policy} availableBalance={spendableBalance(data)} treasuryId={data.treasury.id} disabled={!data.treasury.active||data.treasury.paused||data.policy.validUntil*1000<=Date.now()} busy={busy} mode={data.mode} onRequest={request}/>:<><div className="history-page-actions"><span>{data.treasury.agentName}</span><button className="secondary-button" disabled={busy} onClick={()=>void refresh()}><Icon name="refresh" size={16}/>Refresh history</button><Link className="primary-button" href={`/console?treasuryId=${data.treasury.id}`}>Request a payment</Link></div><PaymentHistory payments={data.payments} mode={data.mode} busy={busy} onProcess={process} initialSelectedId={requestId} treasuryId={data.treasury.id}/></>:<section className="empty-agents"><span className="setup-icon"><Icon name="grid" size={28}/></span><h2>{unavailableAgent?"Agent verification unavailable.":listing.agents.length?reference?"Agent unavailable.":"Choose an agent to continue.":"Create an agent first."}</h2><p>{unavailableAgent?unavailableAgent.message:listing.agents.length?reference?"This wallet does not have an agent matching that link. Choose one of your agents to open its treasury.":"Choose an agent above to view its requests and spending permissions.":"Each payment belongs to an agent with its own treasury and mandate."}</p><Link className="primary-button" href={listing.agents.length || unavailableAgent?"/agents":"/setup"}>{listing.agents.length || unavailableAgent?"View your agents":"Create agent"}</Link></section>}
  </>}
 </WorkspaceShell>;
}
