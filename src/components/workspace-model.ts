import { isAddress } from "viem";
import type { AgentCard, DashboardData, Policy, Service, Payment, Treasury } from "./types";
import type { RequestInput } from "./RequestComposer";
const amounts = /^(0|[1-9]\d{0,12})(\.\d{1,6})?$/;
function units(value: string): bigint {
  if (!amounts.test(value)) throw new Error("Invalid amount");
  const [whole,fraction=""] = value.split(".");
  return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,"0"));
}
function decimal(value: bigint): string {
  const fraction=(value%1000000n).toString().padStart(6,"0").replace(/0+$/,"");
  return `${value/1000000n}${fraction ? "."+fraction : ""}`;
}
export function agentSelection(agents: AgentCard[], reference?: string | null): AgentCard | null {
  if (reference) return agents.find(agent=>agent.id.toLowerCase()===reference.toLowerCase() || agent.agentId.toLowerCase()===reference.toLowerCase())??null;
  return agents.length===1 ? agents[0] : null;
}
export const scopedPath = (path: string, treasuryId: string) => `${path}${path.includes("?") ? "&" : "?"}treasuryId=${encodeURIComponent(treasuryId)}`;
export const agentPath = (agent: Pick<AgentCard,"id">) => `/agent/${encodeURIComponent(agent.id)}`;
export function eligibleServices(services: Service[], policy: Policy): Service[] {
  return services.filter(service=>policy.recipients.some(recipient=>recipient.toLowerCase()===service.recipient.toLowerCase()));
}
export function spendableBalance(data: { treasury: Pick<Treasury,"balance"|"availableBalance"|"spendableBalance">; payments: Pick<Payment,"amount"|"status"|"expiresAt">[] }, now=Date.now()): string {
  if (data.treasury.spendableBalance !== undefined) return data.treasury.spendableBalance;
  if (data.treasury.availableBalance !== undefined) return data.treasury.availableBalance;
  try {
    const pending = new Set(["queued","evaluating","awaiting_finality","approved","executing"]);
    const reserved=data.payments.filter(payment=>pending.has(payment.status) && Date.parse(payment.expiresAt)>now).reduce((total,payment)=>total+units(payment.amount),0n);
    const balance=units(data.treasury.balance);
    return decimal(balance>reserved ? balance-reserved : 0n);
  } catch { return "0"; }
}
export function validateRequest(input: RequestInput, policy: Policy, available: string): string | null {
  if (!isAddress(input.recipient,{strict:true}) || !policy.recipients.some(recipient=>recipient.toLowerCase()===input.recipient.toLowerCase()))
    return "Choose an approved recipient for this agent. Add another recipient by updating the agent's permissions first.";
  if (!amounts.test(input.amount) || units(input.amount)<=0n) return "Enter a positive tUSD8 amount with up to six decimal places.";
  if (units(input.amount)>units(policy.perPaymentLimit)) return "This amount exceeds the agent's per-payment limit.";
  if (units(input.amount)>units(available)) return "This amount exceeds the available funds after pending requests. Fund the vault or wait for existing requests to finish.";
  if (input.service.trim().length<1 || input.service.trim().length>120) return "Name the service or bill in 1–120 characters.";
  if (input.purpose.trim().length<3 || input.purpose.trim().length>1000) return "Describe why the agent needs this payment in 3–1,000 characters.";
  if (input.evidence.length>4000) return "Keep supporting evidence within 4,000 characters.";
  return null;
}

export function renewalExpiry(currentExpiry: number, days: string | undefined, now: number): number {
 if (days === undefined) {
  if (currentExpiry <= now) throw new Error("Authorization has expired. Choose a new duration before saving.");
  return currentExpiry;
 }
 if (!/^\d+$/.test(days) || Number(days)<1 || Number(days)>90)
  throw new Error("Choose a renewal between 1 and 90 whole days.");
 return now+Number(days)*86400;
}
