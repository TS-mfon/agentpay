"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WorkspaceShell from "./WorkspaceShell";
import WalletWelcome from "./WalletWelcome";
import Dialog from "./Dialog";
import SmartAccountActivation from "./SmartAccountActivation";
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
 const [smartConfigError,setSmartConfigError]=useState("");
 const [smartConfigRetry,setSmartConfigRetry]=useState(0);
 const [preview,setPreview]=useState<SmartAccountPreview|null>(null);
 const [activationError,setActivationError]=useState("");
 const [operation,setOperation]=useState<OwnerOperationStatus|null>(null);
 const [operationError,setOperationError]=useState("");
 const smartOwner=listing.ownerAccountType==="smart";
 const canOpenSmartAccount=listing.mode==="live"&&!smartOwner&&Boolean(listing.owner||loginRequired);
 useEffect(()=>setNotice(""),[view,reference]);
 useEffect(()=>{
  if(!canOpenSmartAccount)return;
  let active=true;
  api<{mode:string;smartAccounts?:object}>("/api/config").then(config=>{
   if(active){setSmartAccounts(config.mode==="live"&&!!config.smartAccounts);setSmartConfigError("");}
  }).catch(()=>{if(active)setSmartConfigError("AgentPay couldn’t load QDay smart-account settings.");});
  return()=>{active=false;};
 },[canOpenSmartAccount,smartConfigRetry]);
 const showOperation=useCallback(async(result:OwnerOperationStatus|null)=>{
  setOperation(result);
  setOperationError("");
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
  if(!smartOwner){setOperation(null);setOperationError("");return;}
  let active=true;
  void loadOperation();
  async function loadOperation(){
   try{
    const result=await api<OwnerOperationStatus|null>("/api/owner/user-operations");
    if(active)setOperation(current=>current??result);
   }catch{
    if(active)setOperationError("AgentPay couldn’t check for a saved smart-account operation. Refresh its status before signing.");
   }
  }
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
    if(active&&!result)setOperationError("AgentPay couldn’t find this saved operation. Reconnect with the wallet that controls this smart account.");
   }catch{
    if(active)setOperationError("AgentPay couldn’t check QDay for confirmation. Use Check confirmation to look up the same operation again.");
   }
   if(active)timer=setTimeout(poll,5000);
  }
  timer=setTimeout(poll,2500);
  return()=>{active=false;clearTimeout(timer);};
 },[smartOwner,pendingHash,busy,showOperation]);
 async function connect(){
  setBusy(true);setError("");setNotice("");
  try{const {connectOwner}=await import("./wallet");await connectOwner();setOperation(null);setOperationError("");await refresh(true);}
  catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function switchNetwork(){
  setBusy(true);setError("");setNotice("");
  try{const {switchToAevum}=await import("./wallet");await switchToAevum();setNotice("Your wallet is on Aevum Testnet.");}
  catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function reviewSmartAccount(){
  setBusy(true);setError("");setNotice("");setActivationError("");
  try{const {previewSmartAccount}=await import("./smart-wallet");setPreview(await previewSmartAccount());}
  catch(failure){setError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function activate(){
  if(!preview)return;
  setBusy(true);setError("");setActivationError("");
  try{const {activateSmartAccount}=await import("./smart-wallet");await activateSmartAccount(preview);setPreview(null);await refresh(true);}
  catch(failure){setActivationError(errorMessage(failure));}finally{setBusy(false);}
 }
 function cancelSmartAccount(){
  if(busy)return;
  setPreview(null);setError("");setActivationError("");
 }
 async function checkOperation(rebroadcast:boolean){
  if(!pendingHash)return;
  setBusy(true);setOperationError("");
  try{
   const {resumeOwnerOperation}=await import("./smart-wallet");
   const result=await resumeOwnerOperation(pendingHash,rebroadcast);
   if(!result)throw new Error("AgentPay couldn’t find this saved operation. Reconnect with the wallet that controls this smart account.");
   await showOperation(result);
  }catch(failure){setOperationError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function reloadOperation(){
  setBusy(true);setOperationError("");
  try{await showOperation(await api<OwnerOperationStatus|null>("/api/owner/user-operations"));}
  catch(failure){setOperationError(errorMessage(failure));}finally{setBusy(false);}
 }
 async function disconnect(){
  setBusy(true);setError("");
  try{await api("/api/auth/logout",{});setOperation(null);await refresh(true);setNotice("");}
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
   throw failure;
  }finally{setBusy(false);}
 }
 async function created(payload:DashboardData){
  if(!payload.treasury?.id)throw new Error("The treasury was created but its record was unavailable. Refresh your agents before retrying.");
  router.push(`/agent/${encodeURIComponent(payload.treasury.id)}`);
 }
 const unavailableAgent=listing.unavailable?.find(agent=>reference && (agent.id.toLowerCase()===reference.toLowerCase() || agent.agentId.toLowerCase()===reference.toLowerCase()));
 const selector=view==="console"||view==="history";
 return <WorkspaceShell view={view} owner={listing.owner} smartOwner={smartOwner} mode={listing.mode} busy={busy} treasuryId={data?.treasury.id} onConnect={connect} onDisconnect={disconnect} onSwitchNetwork={listing.mode==="live"&&(listing.owner||loginRequired)?switchNetwork:undefined}>
  {listing.unavailable?.length?<div className="alert alert-error" role="status"><span>{listing.unavailable.length} agent vault{listing.unavailable.length===1?"":"s"} could not be verified.</span><button className="text-button" disabled={busy} onClick={()=>void refresh()}>Retry vault verification</button></div>:null}
  {error?<div className="alert alert-error" role="alert"><span>{error}</span><button className="text-button" disabled={busy} onClick={()=>void refresh()}>Retry</button></div>:null}
  {canOpenSmartAccount&&smartConfigError?<div className="alert alert-error" role="alert"><span>{smartConfigError}</span><button className="text-button" disabled={busy} onClick={()=>setSmartConfigRetry(current=>current+1)}>Retry smart-account settings</button></div>:null}
  {notice?<div className="alert alert-success" role="status"><Icon name="check" size={17}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setNotice("")}><Icon name="close" size={16}/></button></div>:null}
  {listing.owner&&!loading&&(smartOwner||smartAccounts&&canOpenSmartAccount) ? <section className="smart-account-option" aria-label="Treasury owner account">
   <div><strong>{smartOwner?"Smart-account treasuries":"Browser-wallet treasuries"}</strong><p>{smartOwner?"Your browser wallet approves actions for this QDay smart account.":"Looking for an agent created with a QDay smart account? Open that account to see its treasuries."}</p></div>
   <button type="button" className="secondary-button" disabled={busy} onClick={()=>void(smartOwner?connect():reviewSmartAccount())}>{smartOwner?"Use browser wallet":"Open smart account"}</button>
  </section>:null}
  {preview&&listing.owner&&!smartOwner ? <Dialog title="Your QDay smart account" onClose={cancelSmartAccount}>
   <SmartAccountActivation preview={preview} busy={busy} error={activationError} onActivate={activate} onCancel={cancelSmartAccount}/>
  </Dialog>:null}
  {smartOwner&&operation?<SmartOperationNotice operation={operation} busy={busy} checkError={operationError} onCheck={checkOperation} onDismiss={()=>{setOperation(null);setOperationError("");}}/>:smartOwner&&operationError?<div className="alert alert-error" role="alert"><span>{operationError}</span><button className="text-button" disabled={busy} onClick={()=>void reloadOperation()}>Retry operation status</button></div>:null}
  {loading?<div className="loading-workspace" role="status"><span className="loading-spinner"/>Loading your agents…</div>:loginRequired?<WalletWelcome busy={busy} onConnect={connect} onPreview={smartAccounts&&canOpenSmartAccount?reviewSmartAccount:undefined} onActivate={activate} preview={preview} activationError={activationError} onCancel={cancelSmartAccount}/>:error && !listing.owner?<section className="empty-agents"><h2>The workspace is unavailable.</h2><p>Your agents could not be loaded. Retry the connection before creating or paying from a treasury.</p><button className="primary-button" disabled={busy} onClick={()=>void refresh()}>Reload workspace</button></section>:view==="agents"?<AgentsGrid agents={listing.agents} unavailable={listing.unavailable}/>:view==="setup"?<>
   <div className="workspace-heading"><div><h1>Create an agent treasury.</h1><p>{smartOwner?"Your Aevum smart account will own this vault.":"A dedicated vault and a spending mandate, owned by your wallet."}</p></div><Link className="text-button" href="/agents">Back to agents</Link></div>
   <SetupView key={listing.owner} onCreated={created} owner={listing.owner} smartAccount={smartOwner} busy={busy} setBusy={setBusy} pending={Boolean(pendingHash)} onOperation={showOperation}/>
  </>:<>
   {selector?<><div className="workspace-heading"><div><h1>{view==="console"?"Payment console.":"Request history."}</h1><p>{view==="console"?"Request a real governed payment for the selected agent.":"Inspect requests, policy decisions, and settlement receipts for one agent."}</p></div></div><AgentSelector agents={listing.agents} selectedId={data?.treasury.id} page={view}/></>:null}
   {data?view==="agent"?<AgentOverview key={data.treasury.id} data={data} busy={busy} operationPending={Boolean(pendingHash)} onControl={control} onSave={savePolicy} onRefresh={refresh}/>:view==="console"?<RequestComposer key={data.treasury.id} services={data.services} policy={data.policy} availableBalance={spendableBalance(data)} treasuryId={data.treasury.id} disabled={!data.treasury.active||data.treasury.paused||data.policy.validUntil*1000<=Date.now()} busy={busy} mode={data.mode} onRequest={request}/>:<><div className="history-page-actions"><span>{data.treasury.agentName}</span><button className="secondary-button" disabled={busy} onClick={()=>void refresh()}><Icon name="refresh" size={16}/>Refresh history</button><Link className="primary-button" href={`/console?treasuryId=${data.treasury.id}`}>Request a payment</Link></div><PaymentHistory payments={data.payments} mode={data.mode} busy={busy} onProcess={process} initialSelectedId={requestId} treasuryId={data.treasury.id}/></>:<section className="empty-agents"><span className="setup-icon"><Icon name="grid" size={28}/></span><h2>{unavailableAgent?"Agent verification unavailable.":listing.agents.length?reference?"Agent unavailable.":"Choose an agent to continue.":"Create an agent first."}</h2><p>{unavailableAgent?unavailableAgent.message:listing.agents.length?reference?"This wallet does not have an agent matching that link. Choose one of your agents to open its treasury.":"Choose an agent above to view its requests and spending permissions.":"Each payment belongs to an agent with its own treasury and mandate."}</p><Link className="primary-button" href={listing.agents.length || unavailableAgent?"/agents":"/setup"}>{listing.agents.length || unavailableAgent?"View your agents":"Create agent"}</Link></section>}
  </>}
 </WorkspaceShell>;
}
