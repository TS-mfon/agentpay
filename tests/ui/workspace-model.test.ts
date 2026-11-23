import { describe, expect, it } from "vitest";
import { agentSelection, scopedPath, eligibleServices, validateRequest, spendableBalance } from "../../src/components/workspace-model";
import type { AgentCard, DashboardData, Policy } from "../../src/components/types";
const first={id:"0x1111111111111111111111111111111111111111",agentId:"0x"+"aa".repeat(32),agentName:"Mike"} as AgentCard;
const second={id:"0x2222222222222222222222222222222222222222",agentId:"0x"+"bb".repeat(32),agentName:"Scout"} as AgentCard;
const recipient="0xdce1ae1deb32d990dff06a0fcba435ea9fad39d9";
const policy={recipients:[recipient],perPaymentLimit:"10",weeklyBudget:"40",totalBudget:"200",mandate:"Household bills only",version:1,mandateHash:"",validUntil:4102444800} as Policy;
const request={recipient,amount:"0.001",service:"Water bill",purpose:"Pay household water",evidence:"",idempotencyKey:"water-001"};
describe("independent owner routes",()=>{
 it("requires a selection when multiple owned agents exist",()=>{
  expect(agentSelection([first,second],undefined)).toBeNull();
  expect(agentSelection([first],undefined)?.id).toBe(first.id);
 });
 it("selects a known vault or agent id without falling back for unknown references",()=>{
  expect(agentSelection([first,second],second.agentId)?.id).toBe(second.id);
  expect(agentSelection([first],second.id)).toBeNull();
 });
 it("scopes every owner API route without altering its payload",()=>{
  expect(scopedPath("/api/owner/payments",first.id)).toBe(`/api/owner/payments?treasuryId=${first.id}`);
 });
 it("offers only services whose recipient is approved",()=>{
  const service={name:"Provider",description:"Test provider",amount:"1",purpose:"Household bill",evidence:""};
  const services:DashboardData["services"]=[{...service,id:"yes",recipient:recipient.toUpperCase()},{...service,id:"no",recipient:second.id}];
  expect(eligibleServices(services,policy).map(s=>s.id)).toEqual(["yes"]);
 });
 it("explains unapproved recipients and validates available funds before request",()=>{
  expect(validateRequest({...request,recipient:second.id},policy,"0.01")).toMatch(/approved recipient/i);
  expect(validateRequest({...request,amount:"0.02"},policy,"0.01")).toMatch(/available/i);
  expect(validateRequest({...request,amount:"10.01"},policy,"20")).toMatch(/per-payment/i);
  expect(validateRequest(request,policy,"0.01")).toBeNull();
 });
 it("subtracts queued reservations from balance without rounding",()=>{
  const data={treasury:{balance:"0.05"},payments:[{amount:"0.007",status:"queued" as const,expiresAt:"2099-01-01T00:00:00Z"},{amount:"0.001",status:"rejected" as const,expiresAt:"2099-01-01T00:00:00Z"}]};
  expect(spendableBalance(data)).toBe("0.043");
 });
 it("uses server-authorized spending capacity ahead of raw available balance",()=>{
  const data={treasury:{balance:"0.05",availableBalance:"0.043",spendableBalance:"0.02"},payments:[]};
  expect(spendableBalance(data)).toBe("0.02");
  expect(spendableBalance({...data,treasury:{...data.treasury,spendableBalance:undefined}})).toBe("0.043");
 });
 it("rejects malformed amounts, missing purpose, and oversized evidence",()=>{
  expect(validateRequest({...request,amount:"1e-3"},policy,"1")).toMatch(/positive/i);
  expect(validateRequest({...request,amount:"0"},policy,"1")).toMatch(/positive/i);
  expect(validateRequest({...request,service:""},policy,"1")).toMatch(/name/i);
  expect(validateRequest({...request,purpose:"x"},policy,"1")).toMatch(/describe/i);
  expect(validateRequest({...request,evidence:"x".repeat(4001)},policy,"1")).toMatch(/4,000/i);
 });
 it("fails closed for malformed balance and clamps reserved funds at zero",()=>{
  expect(spendableBalance({treasury:{balance:"bad"},payments:[]})).toBe("0");
  expect(spendableBalance({treasury:{balance:"0.001"},payments:[{amount:"0.003",status:"queued" as const,expiresAt:"2099-01-01T00:00:00Z"}]})).toBe("0");
 });

});
