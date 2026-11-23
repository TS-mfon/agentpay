"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import Icon from "./Icon";
import { ApiError } from "./api";
import { formatMoney, shorten } from "./view-model";
import { eligibleServices, validateRequest } from "./workspace-model";
import type { Policy, Service } from "./types";
export const correctableRequestErrors = new Set(["INVALID_REQUEST","INVALID_CONTENT_TYPE","INVALID_JSON","REQUEST_TOO_LARGE","PAYMENT_LIMIT","WEEKLY_BUDGET","TOTAL_BUDGET","INSUFFICIENT_BALANCE","RECIPIENT_NOT_ALLOWED","TREASURY_PAUSED","AGENT_REVOKED","POLICY_EXPIRED","POLICY_CHANGED","POLICY_NOT_FOUND","AUTHORITY_CHANGED","UNAUTHORIZED","TREASURY_SELECTION_REQUIRED","VAULT_MISMATCH"]);
export interface RequestInput {recipient:string;amount:string;service:string;purpose:string;evidence:string;idempotencyKey:string;}
export default function RequestComposer({services,policy,availableBalance,treasuryId,disabled,busy,mode,onRequest}:{
 services:Service[];policy:Policy;availableBalance:string;treasuryId:string;disabled:boolean;busy:boolean;mode:"demo"|"live";onRequest:(input:RequestInput)=>Promise<void>;
}){
 const [form,setForm]=useState({recipient:policy.recipients.length===1?policy.recipients[0]:"",amount:"",service:"",purpose:"",evidence:""});
 const [error,setError]=useState("");
 const [submitted,setSubmitted]=useState<RequestInput|null>(null);
 const [complete,setComplete]=useState(false);
 const approvedServices=eligibleServices(services,policy);
 function update(field:keyof typeof form,value:string){setForm(current=>({...current,[field]:value}));setError("");}
 function choose(service:Service){setForm({recipient:service.recipient,amount:service.amount,service:service.name,purpose:service.purpose,evidence:service.evidence});setError("");}
 function reset(){setForm({recipient:policy.recipients.length===1?policy.recipients[0]:"",amount:"",service:"",purpose:"",evidence:""});setSubmitted(null);setComplete(false);setError("");}
 async function submit(event:FormEvent){
  event.preventDefault();if(busy || disabled || complete)return;
  const retrying=submitted!==null;
  const input=submitted??{...form,idempotencyKey:crypto.randomUUID()};
  const failure=validateRequest(input,policy,availableBalance);
  if(failure && !submitted){setError(failure);return;}
  setError("");setSubmitted(input);
  try{await onRequest(input);setComplete(true);}catch(failure){if(!retrying && failure instanceof ApiError && correctableRequestErrors.has(failure.code))setSubmitted(null);setError(failure instanceof Error?failure.message:"The payment request could not be recorded. Check history before starting another request.");}
 }
 const history=`/history?treasuryId=${encodeURIComponent(treasuryId)}`;
 return <section className="payment-console" aria-labelledby="services-title"><div className="console-layout"><div className="console-form-column"><h2 id="services-title">Request a payment.</h2><p className="section-description">Name the bill or service, explain its purpose, and choose an approved recipient.</p>
  {approvedServices.length ? <div className="console-presets"><p>Configured services</p><div>{approvedServices.map(service=><button key={service.id} type="button" className="secondary-button" disabled={busy || disabled || Boolean(submitted)} onClick={()=>choose(service)}>{service.name}<Icon name="arrow" size={15}/></button>)}</div></div>:null}
  <form className="stack-form console-request-form" noValidate onSubmit={submit}><fieldset disabled={busy || disabled || Boolean(submitted)} className="setup-fields"><label>Service or bill<input required maxLength={120} value={form.service} placeholder="What is the agent paying for?" onChange={event=>update("service",event.target.value)}/></label><label htmlFor="request-recipient">Approved recipient</label><select id="request-recipient" required value={form.recipient} onChange={event=>update("recipient",event.target.value)} aria-describedby="recipient-help"><option value="" disabled>Choose an approved recipient</option>{policy.recipients.map(recipient=><option value={recipient} key={recipient}>{shorten(recipient)}</option>)}</select><p id="recipient-help" className="field-help">Only these addresses are authorized for this agent. Owner approval does not verify merchant identity. Check the selected address with your provider. <Link href={`/agent/${treasuryId}`}>Edit recipients in the agent's spending rules.</Link></p>{form.recipient?<p className="console-recipient-address">{form.recipient}</p>:null}<label>Amount in tUSD8<input required inputMode="decimal" value={form.amount} placeholder="0.00" onChange={event=>update("amount",event.target.value)}/></label><p className="field-help">Available: {formatMoney(availableBalance)} tUSD8. Per-payment cap: {formatMoney(policy.perPaymentLimit)} tUSD8.</p><label htmlFor="request-purpose">Payment purpose</label><textarea id="request-purpose" required rows={3} minLength={3} maxLength={1000} value={form.purpose} placeholder="Explain how this payment supports the agent's mandate." onChange={event=>update("purpose",event.target.value)}/><label>Supporting evidence <span className="optional-label">Optional</span><textarea rows={3} maxLength={4000} value={form.evidence} placeholder="Invoice details or relevant context. Do not include private household or account information." onChange={event=>update("evidence",event.target.value)}/></label><p className="field-help">Service, purpose, evidence, and mandate text are sent to GenLayer in transaction data. Keep names, locations, account numbers, and private invoice details out of these fields.</p></fieldset>
   {disabled?<p className="control-note">{policy.validUntil*1000<=Date.now()?"This agent's authorization has expired. Renew it on the agent page before requesting another payment.":"This agent's payments are stopped. Resume its treasury or renew its authorization on the agent page."} <Link href={`/agent/${treasuryId}`}>Open agent controls</Link></p>:null}
   {error?<div role="alert" className="console-error"><p>{error}</p>{submitted?<p>The original request reference is preserved. Retry the same request or inspect history before creating another purchase.</p>:null}</div>:null}
   {complete?<div className="request-recorded" role="status"><Icon name="check" size={21}/><div><strong>Payment request recorded.</strong><p>Acceptance is not payment. Follow the decision and settlement in request history.</p><Link className="primary-button" href={history}>View request history <Icon name="arrow" size={17}/></Link><button type="button" className="text-button" onClick={reset}>Make another request</button></div></div>:<div className="console-submit"><button className="primary-button" disabled={busy || disabled || !policy.recipients.length}><Icon name="send" size={18}/>{busy?"Recording request…":submitted?"Retry the same request":"Submit payment request"}</button>{submitted?<Link className="text-button" href={history}>Check request history</Link>:null}</div>}
   {submitted?<details className="request-reference"><summary>Request reference</summary><p>{submitted.idempotencyKey}</p><p>This purchase reference prevents a retry from creating another payment.</p></details>:null}
  </form>
 </div><aside className="console-policy"><span className="setup-icon"><Icon name="shield" size={28}/></span><h3>The agent's mandate</h3><p>{policy.mandate}</p><dl><div><dt>Per payment</dt><dd>{formatMoney(policy.perPaymentLimit)} tUSD8</dd></div><div><dt>Weekly budget</dt><dd>{formatMoney(policy.weeklyBudget)} tUSD8</dd></div><div><dt>Available funds</dt><dd>{formatMoney(availableBalance)} tUSD8</dd></div></dl><p className="console-execution-note">{mode==="demo"?"This isolated test environment simulates evaluation and settlement.":"GenLayer evaluates purpose. The hosted executor settles only finalized approvals on Aevum. Requests can take several minutes."}</p><Link className="text-button" href="/docs#lifecycle">How payments work</Link></aside></div></section>;
}
