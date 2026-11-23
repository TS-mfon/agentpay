import { expect,it } from "vitest";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState,demoPorts,DEMO_OWNER,DEMO_RECIPIENT } from "../../src/server/demo";
const initialTime=1800000000000;
const input={recipient:DEMO_RECIPIENT,amount:"4",service:"Research API",purpose:"Research data",evidence:"Research data invoice",idempotencyKey:"reservation-test-0001"};
it("returns exact spendable funds and budgets after pending commitments",async()=>{
 const service=new AgentPayService(new MemoryStore(demoState(initialTime)),{...demoPorts(),now:()=>initialTime},"demo");
 await service.requestPayment(DEMO_OWNER,input);
 const dashboard=await service.dashboard(DEMO_OWNER);
 expect(dashboard.treasury).toMatchObject({balance:"100",reservedBalance:"4",availableBalance:"96",availableWeeklyBudget:"36",availableTotalBudget:"96",spendableBalance:"36"});
});
it("keeps an expired but executing transfer reserved until settlement is known",async()=>{
 let now=initialTime;const store=new MemoryStore(demoState(now));
 const service=new AgentPayService(store,{...demoPorts(),now:()=>now},"demo");
 const payment=await service.requestPayment(DEMO_OWNER,input);
 await service.control(DEMO_OWNER,{action:"withdraw",amount:"94"});
 await store.update(s=>({...s,payments:s.payments.map(p=>p.id===payment.id?{...p,status:"executing"}:p)}));
 now+=3600001;
 expect((await service.dashboard(DEMO_OWNER)).treasury).toMatchObject({balance:"6",reservedBalance:"4",availableBalance:"2"});
 await expect(service.requestPayment(DEMO_OWNER,{...input,amount:"3",idempotencyKey:"reservation-test-0002"})).rejects.toMatchObject({code:"INSUFFICIENT_BALANCE"});
});
it("releases unexecuted expired commitments without hiding settled spending",async()=>{
 let now=initialTime;const service=new AgentPayService(new MemoryStore(demoState(now)),{...demoPorts(),now:()=>now},"demo");
 await service.requestPayment(DEMO_OWNER,input);now+=3600001;
 expect((await service.dashboard(DEMO_OWNER)).treasury).toMatchObject({reservedBalance:"0",availableBalance:"100",availableWeeklyBudget:"40"});
});
