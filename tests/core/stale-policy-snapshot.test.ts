import { expect, it } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState, demoPorts, DEMO_OWNER, DEMO_RECIPIENT } from "../../src/server/demo";
import { hashText } from "../../src/core/validation";
import type { VaultSnapshot } from "../../src/core/ports";
const now=1800000000000;
function fixture(){
 const initial=demoState(now),old=initial.treasuries[0],policy=initial.policies[0];
 const {treasuryId,agentId,version,mandateHash,...next}= {...policy,mandate:"Only research APIs and approved datasets. No other purchases."};
 let chain:VaultSnapshot={...old,...policy,policyVersion:1};
 let release!:()=>void, entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const captured=new Promise<void>(resolve=>{entered=resolve;});
 let calls=0;
 const store=new MemoryStore(initial);
 const service=new AgentPayService(store,{...demoPorts(),now:()=>now,settlement:{...demoPorts().settlement,snapshot:async()=>{
   calls++;
   if(calls===1){const snapshot={...chain};entered();await gate;return snapshot;}
   return {...chain};
 }}},"live");
 return {service,store,release,captured,next,advance:()=>{chain={...chain,...next,policyVersion:2,mandateHash:hashText(next.mandate)};}};
}
it("rejects an in-flight request when the owner changes its mandate before commit",async()=>{
 const f=fixture();
 const request=f.service.requestPayment(DEMO_OWNER,{recipient:DEMO_RECIPIENT,amount:"4",service:"Research API",purpose:"Research dataset",evidence:"Dataset invoice",idempotencyKey:"stale-policy-test"});
 await f.captured; f.advance(); await f.service.updatePolicy(DEMO_OWNER,f.next);f.release();
 await expect(request).rejects.toMatchObject({code:"POLICY_CHANGED"});
 const dashboard=await f.service.dashboard(DEMO_OWNER);
 expect(dashboard.policy?.version).toBe(2);
 expect(dashboard.treasury?.policyVersion).toBe(2);
 expect(dashboard.payments).toHaveLength(0);
});
it("does not mark the new mandate inactive or overwrite its metadata with a delayed dashboard snapshot",async()=>{
 const f=fixture();
 const oldDashboard=f.service.dashboard(DEMO_OWNER);
 await f.captured;f.advance();await f.service.updatePolicy(DEMO_OWNER,f.next);f.release();
 const dashboard=await oldDashboard;
 expect(dashboard.policy?.version).toBe(2);
 expect(dashboard.treasury?.active).toBe(true);
 expect(dashboard.treasury?.policyVersion).toBe(2);
 expect((await f.store.read()).treasuries[0]).toMatchObject({active:true,policyVersion:2});
});
