"use client";
import { useEffect, useState, type FormEvent } from "react";
import Dialog from "./Dialog";
import Icon from "./Icon";
import { formatMoney, shorten } from "./view-model";
import { emptySetup, parseRecipients, validateSetupStep } from "./onboarding";
import { renewalExpiry } from "./workspace-model";
import type { Policy } from "./types";
export default function MandatePanel({policy,busy,onSave,editRequest=0}:{policy:Policy;busy:boolean;editRequest?:number;onSave:(policy:Omit<Policy,"version"|"mandateHash">)=>Promise<void>}){
 const [editing,setEditing]=useState(false);
 const [form,setForm]=useState({mandate:policy.mandate,perPaymentLimit:policy.perPaymentLimit,weeklyBudget:policy.weeklyBudget,totalBudget:policy.totalBudget,recipients:policy.recipients.join("\n")});
 const [renew,setRenew]=useState(false);
 const [days,setDays]=useState("30");
 const [error,setError]=useState("");
 const expired=policy.validUntil*1000<=Date.now();
 const open=()=>{setForm({mandate:policy.mandate,perPaymentLimit:policy.perPaymentLimit,weeklyBudget:policy.weeklyBudget,totalBudget:policy.totalBudget,recipients:policy.recipients.join("\n")});setRenew(expired);setDays("30");setError("");setEditing(true);};
 useEffect(()=>{if(editRequest>0)open();},[editRequest]);
 async function save(event:FormEvent){
  event.preventDefault();setError("");
  try{
   const budgetFailure=validateSetupStep(1,{...emptySetup,...form},true);
   if(budgetFailure)throw new Error(budgetFailure);
   const recipients=parseRecipients(form.recipients);
   const validUntil=renewalExpiry(policy.validUntil,renew?days:undefined,Math.floor(Date.now()/1000));
   await onSave({...form,recipients,validUntil});setEditing(false);
  }catch(failure){setError(failure instanceof Error?failure.message:"The mandate could not be saved.");}
 }
 const preview=/^\d+$/.test(days)&&Number(days)>=1&&Number(days)<=90?new Date(Date.now()+Number(days)*86400000).toUTCString():null;
 return <section className="panel mandate-panel" aria-labelledby="mandate-title"><div className="panel-heading"><div><h2 id="mandate-title">The agent's mandate</h2></div><span className="version">Version {policy.version}</span></div><blockquote>{policy.mandate}</blockquote><div className="mandate-limits"><div><span>Per payment</span><strong>{formatMoney(policy.perPaymentLimit)} <small>tUSD8</small></strong></div><div><span>Weekly budget</span><strong>{formatMoney(policy.weeklyBudget)} <small>tUSD8</small></strong></div><div><span>Approved recipients</span><strong>{policy.recipients.length} <small>addresses</small></strong></div></div>
  <p className={`mandate-expiry ${expired?"control-note":"muted"}`}>{expired?"Authorization expired. Renew the expiry before requesting another payment.":`Authorization expires ${new Date(policy.validUntil*1000).toUTCString()}.`}</p><div className="panel-footer"><span><Icon name="shield" size={16}/>Hard limits apply to every payment.</span><button className="text-button" onClick={open} disabled={busy}>{expired?"Renew authorization":"Edit mandate"}</button></div>
  {editing?<Dialog title="Edit spending mandate" onClose={()=>setEditing(false)}><form className="stack-form" noValidate onSubmit={save}><p className="muted">This creates a new policy version. Previous decisions keep their original mandate, and settled spending is preserved. Pending approvals do not inherit the new authority.</p><label>Financial mandate<textarea required minLength={20} maxLength={4000} rows={5} value={form.mandate} onChange={event=>setForm(current=>({...current,mandate:event.target.value}))}/></label><div className="form-columns"><label>Maximum per payment<input required inputMode="decimal" value={form.perPaymentLimit} onChange={event=>setForm(current=>({...current,perPaymentLimit:event.target.value}))}/></label><label>Weekly budget<input required inputMode="decimal" value={form.weeklyBudget} onChange={event=>setForm(current=>({...current,weeklyBudget:event.target.value}))}/></label><label>Lifetime budget<input required inputMode="decimal" value={form.totalBudget} onChange={event=>setForm(current=>({...current,totalBudget:event.target.value}))}/></label></div><label>Approved recipient addresses<textarea required rows={3} value={form.recipients} onChange={event=>setForm(current=>({...current,recipients:event.target.value}))}/><small>One verified-with-provider address per line. Owner approval does not verify merchant identity.</small></label><div className="mandate-renewal"><label className="renewal-option"><input type="checkbox" checked={renew} disabled={expired||busy} onChange={event=>setRenew(event.target.checked)}/>Set a new authorization expiry</label>{expired?<p className="control-note">The current expiry has passed. Choose how long to authorize this agent again.</p>:<p className="field-help">Keep the existing expiry unless you deliberately renew the agent's authority.</p>}{renew?<><label>Authorization duration in days<input inputMode="numeric" value={days} disabled={busy} onChange={event=>setDays(event.target.value)}/></label><p className="field-help">1–90 whole days. {preview?`New expiry: ${preview}.`:"Enter a valid duration to preview expiry."}</p></>:<p className="field-help">Current expiry: {new Date(policy.validUntil*1000).toUTCString()}.</p>}</div><p className="field-help">Mandate text is submitted to GenLayer as transaction data. Keep private personal information out of it.</p>{error?<p role="alert" className="form-error">{error}</p>:null}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={()=>setEditing(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy?"Saving mandate…":renew?"Save and renew authorization":"Save new mandate"}</button></div></form></Dialog>:null}<span className="sr-only">Mandate hash {shorten(policy.mandateHash)}</span>
 </section>;
}
