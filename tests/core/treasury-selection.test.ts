import { describe, expect, it } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState, demoPorts, DEMO_OWNER, DEMO_TREASURY, DEMO_RECIPIENT } from "../../src/server/demo";
import { hashText } from "../../src/core/validation";

const secondVault = "0x7777777777777777777777777777777777777777";
const foreignVault = "0x8888888888888888888888888888888888888888";
const now = 1800000000000;
function fixture() {
  const initial = demoState(now);
  const treasury = initial.treasuries[0];
  const policy = initial.policies[0];
  const state = { ...initial, treasuries:[treasury, { ...treasury, id:secondVault, agentId:hashText("second-agent"), agentName:"Second agent" }, { ...treasury, id:foreignVault, owner:foreignVault, agentId:hashText("foreign-agent") }], policies:[policy,{ ...policy, treasuryId:secondVault, agentId:hashText("second-agent") },{ ...policy, treasuryId:foreignVault, agentId:hashText("foreign-agent") }] };
  const store = new MemoryStore(state);
  return {store, service:new AgentPayService(store,{...demoPorts(),now:()=>now},"demo")};
}
const payment = { recipient:DEMO_RECIPIENT, amount:"4", service:"Research API",purpose:"Research data purchase",evidence:"Research invoice",idempotencyKey:"same-purchase-0001" };

describe("owner treasury selection and credential isolation",()=>{
  it("requires a selected treasury when an owner has multiple agents",async()=>{
    const {service}=fixture();
    await expect(service.dashboard(DEMO_OWNER)).rejects.toMatchObject({code:"TREASURY_SELECTION_REQUIRED"});
    expect((await service.dashboard(DEMO_OWNER,secondVault)).treasury?.id).toBe(secondVault);
    await expect(service.dashboard(DEMO_OWNER,foreignVault)).rejects.toMatchObject({code:"TREASURY_NOT_FOUND"});
  });
  it("keeps same-key purchases and history isolated between two owned vaults",async()=>{
    const {service}=fixture();
    const first=await service.requestPayment(DEMO_OWNER,payment,DEMO_TREASURY);
    const second=await service.requestPayment(DEMO_OWNER,payment,secondVault);
    expect(first.id).not.toBe(second.id);
    expect((await service.dashboard(DEMO_OWNER,DEMO_TREASURY)).payments.map(p=>p.id)).toEqual([first.id]);
    await expect(service.getPayment(DEMO_OWNER,second.id,DEMO_TREASURY)).rejects.toMatchObject({code:"PAYMENT_NOT_FOUND"});
    expect((await service.getPayment(DEMO_OWNER,second.id,secondVault)).treasuryId).toBe(secondVault);
  });
  it("scopes keys, rotation, revocation and owner controls to their selected vault",async()=>{
    const {service}=fixture();
    const first=await service.issueCredential(DEMO_OWNER,DEMO_TREASURY);
    const second=await service.issueCredential(DEMO_OWNER,secondVault);
    expect((await service.authenticateAgent(second.key)).treasuryId).toBe(secondVault);
    await service.issueCredential(DEMO_OWNER,DEMO_TREASURY);
    await expect(service.authenticateAgent(first.key)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect((await service.authenticateAgent(second.key)).treasuryId).toBe(secondVault);
    await service.control(DEMO_OWNER,{action:"revoke"},DEMO_TREASURY);
    expect((await service.dashboard(DEMO_OWNER,DEMO_TREASURY)).treasury?.active).toBe(false);
    expect((await service.dashboard(DEMO_OWNER,secondVault)).treasury?.active).toBe(true);
    await expect(service.control(DEMO_OWNER,{action:"fund",amount:"1"},foreignVault)).rejects.toMatchObject({code:"TREASURY_NOT_FOUND"});
  });
  it("lists only owned agents without payment or credential data",async()=>{
    const {service}=fixture();
    const listing=await service.listAgents(DEMO_OWNER);
    expect(listing.agents.map(t=>t.id)).toEqual([DEMO_TREASURY,secondVault]);
    expect(listing.agents[1]).toMatchObject({agentName:"Second agent",perPaymentLimit:"10",weeklyBudget:"40"});
    expect(JSON.stringify(listing)).not.toMatch(/credentials|digest|sessions|rawTransaction/);
  });
  it("allows a new distinct vault for an existing owner but rejects duplicate registration",async()=>{
    const initial=demoState(now);
    const service=new AgentPayService(new MemoryStore(initial),{...demoPorts(),now:()=>now},"demo");
    const {treasuryId,agentId,version,mandateHash,...policy}=initial.policies[0];
    const created=await service.setup(DEMO_OWNER,{...policy,treasuryId:secondVault,agentName:"New agent"});
    expect(created.treasury?.id).toBe(secondVault);
    await expect(service.setup(DEMO_OWNER,{...policy,treasuryId:secondVault,agentName:"Again"})).rejects.toMatchObject({code:"TREASURY_EXISTS"});
  });
});

it("rejects a payment using authority captured before its agent key was rotated",async()=>{
 const {service}=fixture();
 const issued=await service.issueCredential(DEMO_OWNER,DEMO_TREASURY);
 const identity=await service.authenticateAgent(issued.key);
 await service.issueCredential(DEMO_OWNER,DEMO_TREASURY);
 await expect(service.requestPayment(identity.owner,payment,identity.treasuryId,identity)).rejects.toMatchObject({code:"UNAUTHORIZED"});
 expect((await service.dashboard(DEMO_OWNER,DEMO_TREASURY)).payments).toHaveLength(0);
});

describe("failure isolation across live vault listings",()=>{
  function liveFixture(failure:"rpc"|"owner"){
    const initial=demoState(now),first=initial.treasuries[0],policy=initial.policies[0];
    const second={...first,id:secondVault,agentId:hashText("second-agent"),agentName:"Second agent"};
    const secondPolicy={...policy,treasuryId:secondVault,agentId:second.agentId};
    const store=new MemoryStore({...initial,treasuries:[first,second],policies:[policy,secondPolicy]});
    const ports=demoPorts();
    return new AgentPayService(store,{...ports,now:()=>now,settlement:{...ports.settlement,snapshot:async(t)=>{
      if(t.id===secondVault){
        if(failure==="rpc")throw new Error("PRIVATE_RPC_DIAGNOSTIC");
        return {...second,...secondPolicy,owner:foreignVault,policyVersion:1};
      }
      return {...first,...policy,policyVersion:1};
    }}},"live");
  }
  it("keeps healthy agents available when another vault RPC refresh fails",async()=>{
    const service=liveFixture("rpc");
    const listing=await service.listAgents(DEMO_OWNER);
    expect(listing.agents.map(t=>t.id)).toEqual([DEMO_TREASURY]);
    expect(listing.unavailable).toEqual([{id:secondVault,agentId:hashText("second-agent"),agentName:"Second agent",code:"VAULT_UNAVAILABLE",message:"This vault could not be refreshed. Try again shortly."}]);
    expect(JSON.stringify(listing)).not.toContain("PRIVATE_RPC_DIAGNOSTIC");
    expect(listing.unavailable[0]).not.toHaveProperty("balance");
    expect((await service.dashboard(DEMO_OWNER,DEMO_TREASURY)).treasury?.id).toBe(DEMO_TREASURY);
  });
  it("warns about ownership mismatch without blocking or exposing another vault",async()=>{
    const service=liveFixture("owner");
    const listing=await service.listAgents(DEMO_OWNER);
    expect(listing.agents.map(t=>t.id)).toEqual([DEMO_TREASURY]);
    expect(listing.unavailable).toMatchObject([{id:secondVault,code:"VAULT_MISMATCH"}]);
    expect(listing.unavailable[0]).not.toHaveProperty("balance");
    await expect(service.dashboard(DEMO_OWNER,secondVault)).rejects.toMatchObject({code:"VAULT_MISMATCH"});
    await expect(service.control(DEMO_OWNER,{action:"withdraw",amount:"1"},secondVault)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect((await service.dashboard(DEMO_OWNER,DEMO_TREASURY)).treasury?.active).toBe(true);
  });
});
