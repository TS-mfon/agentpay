import { describe,expect,it,vi,beforeEach } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState,demoPorts,DEMO_OWNER,DEMO_TREASURY,DEMO_RECIPIENT } from "../../src/server/demo";
import { hashText } from "../../src/core/validation";
const holder=vi.hoisted(()=>({runtime:undefined as unknown}));
vi.mock("../../src/server/runtime",()=>({getRuntime:async()=>holder.runtime}));
import { GET as treasuryGET } from "../../src/app/api/v1/treasury/route";
import { GET as policyGET } from "../../src/app/api/v1/policy/route";
import { GET as paymentsGET,POST as paymentsPOST } from "../../src/app/api/v1/payments/route";
import { GET as paymentGET } from "../../src/app/api/v1/payments/[id]/route";
import { GET as agentsGET } from "../../src/app/api/owner/agents/route";
import { GET as dashboardGET } from "../../src/app/api/owner/dashboard/route";
const second="0x7777777777777777777777777777777777777777";
let key:string,service:AgentPayService;
beforeEach(async()=>{
 const initial=demoState();const treasury={...initial.treasuries[0],id:second,agentId:hashText("second-agent"),agentName:"Second agent"};
 const store=new MemoryStore({...initial,treasuries:[...initial.treasuries,treasury],policies:[...initial.policies,{...initial.policies[0],treasuryId:second,agentId:treasury.agentId}]});
 service=new AgentPayService(store,demoPorts(),"demo");
 key=(await service.issueCredential(DEMO_OWNER,second)).key;
 holder.runtime={mode:"demo",store,service,auth:{owner:async()=>DEMO_OWNER}};
});
const req=(path:string,body?:unknown)=>new Request("http://localhost:3000"+path,{method:body?"POST":"GET",headers:{authorization:"Bearer "+key,...(body?{"Content-Type":"application/json"}:{} )},...(body?{body:JSON.stringify(body)}:{})});
const purchase={recipient:DEMO_RECIPIENT,amount:"4",service:"Research API",purpose:"Research data purchase",evidence:"Research invoice",idempotencyKey:"scope-payment-0001"};
describe("agent route identity scope",()=>{
 it("ignores a foreign treasury query and returns the credential-bound treasury and mandate",async()=>{
  const treasury=await (await treasuryGET(req('/api/v1/treasury?treasuryId='+DEMO_TREASURY))).json();
  expect(treasury.data.id).toBe(second);
  const policy=await (await policyGET(req('/api/v1/policy?treasuryId='+DEMO_TREASURY))).json();expect(policy.data.treasuryId).toBe(second);
 });
 it("creates and lists payments only within the credential-bound vault",async()=>{
  const result=await (await paymentsPOST(req('/api/v1/payments?treasuryId='+DEMO_TREASURY,purchase))).json();
  expect(result.data.treasuryId).toBe(second);
  const foreign=await service.requestPayment(DEMO_OWNER,{...purchase,idempotencyKey:"other-vault-request"},DEMO_TREASURY);
  const history=await (await paymentsGET(req('/api/v1/payments'))).json();expect(history.data.map((p:{id:string})=>p.id)).toEqual([result.data.id]);
  expect((await paymentGET(req('/api/v1/payments/'+foreign.id),{params:Promise.resolve({id:foreign.id})})).status).toBe(404);
 });
 it("offers owned cards while requiring an explicit owner dashboard selection",async()=>{
  const listing=await (await agentsGET(req('/api/owner/agents'))).json();expect(listing.data.agents.map((t:{id:string})=>t.id)).toEqual([DEMO_TREASURY,second]);
  expect((await dashboardGET(req('/api/owner/dashboard'))).status).toBe(409);
  const selected=await (await dashboardGET(req('/api/owner/dashboard?treasuryId='+second))).json();expect(selected.data.treasury.id).toBe(second);
  expect((await dashboardGET(req('/api/owner/dashboard?treasuryId=invalid'))).status).toBe(400);
  expect((await dashboardGET(req('/api/owner/dashboard?treasuryId='+second+'&treasuryId='+DEMO_TREASURY))).status).toBe(400);
 });
});
