import { describe,expect,it,vi,beforeEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AgentPayService } from "../../src/core/service";
import { MemoryStore } from "../../src/server/memory-store";
import { demoState,demoPorts,DEMO_OWNER,DEMO_TREASURY,DEMO_RECIPIENT } from "../../src/server/demo";
import { hashText } from "../../src/core/validation";
import { OwnerAuth } from "../../src/server/auth";
const holder=vi.hoisted(()=>({runtime:undefined as unknown}));
vi.mock("../../src/server/runtime",()=>({getRuntime:async()=>holder.runtime}));
import { GET as paymentsGET,POST as paymentsPOST } from "../../src/app/api/v1/payments/route";
import { GET as paymentGET } from "../../src/app/api/v1/payments/[id]/route";
import { GET as agentsGET } from "../../src/app/api/owner/agents/route";
import { GET as dashboardGET } from "../../src/app/api/owner/dashboard/route";
import { GET as ownerPaymentsGET } from "../../src/app/api/owner/payments/route";
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
 it("creates and lists payments only within the credential-bound vault",async()=>{
  const result=await (await paymentsPOST(req('/api/v1/payments?treasuryId='+DEMO_TREASURY,purchase))).json();
  expect(result.data.treasuryId).toBe(second);
  const foreign=await service.requestPayment(DEMO_OWNER,{...purchase,idempotencyKey:"other-vault-request"},DEMO_TREASURY);
  const history=await (await paymentsGET(req('/api/v1/payments?treasuryId='+DEMO_TREASURY))).json();expect(history.data.map((p:{id:string})=>p.id)).toEqual([result.data.id]);
  expect((await paymentGET(req('/api/v1/payments/'+foreign.id),{params:Promise.resolve({id:foreign.id})})).status).toBe(404);
 });
 it("keeps private inputs and decisions out of submission, history, status and replay", async () => {
  const path = "/api/v1/payments";
  const transactionHash = hashText("settlement");
  const submittedResponse = await paymentsPOST(req(path, purchase));
  expect(submittedResponse.status).toBe(200);
  const submitted = (await submittedResponse.json()).data;
  expect(submitted).toEqual({
    id: expect.stringMatching(/^0x[0-9a-f]{64}$/), treasuryId: second,
    agentId: hashText("second-agent"), recipient: DEMO_RECIPIENT, amount: "4", amountUnits: "4000000",
    idempotencyKey: purchase.idempotencyKey, policyVersion: 1,
    createdAt: expect.any(String), expiresAt: expect.any(String), status: "queued", attempts: 0,
  });
  for (const status of ["settled", "failed"] as const) {
    await service.store.update(state => ({
      ...state, payments: state.payments.map(payment => payment.id === submitted.id ? {
        ...payment, status, transactionHash, attempts: 2,
        decisionReason: "PRIVATE_DECISION", error: "PRIVATE_WORKER_ERROR",
        decisionRef: hashText("PRIVATE_DECISION"), evaluationReferences: [hashText("PRIVATE_ATTEMPT")],
      } : payment),
    }));
    const detailPath = path + "/" + submitted.id;
    const detail = await paymentGET(req(detailPath), { params: Promise.resolve({ id: submitted.id }) });
    const expected = {
      ...submitted, status, attempts: 2, transactionHash,
      ...(status === "settled" ? { requestHash: (await service.getPayment(DEMO_OWNER, submitted.id, second)).requestHash } : {}),
    };
    expect((await detail.json()).data).toEqual(expected);
    expect((await (await paymentsGET(req(path))).json()).data).toEqual([expected]);
    expect((await (await paymentsPOST(req(path, purchase))).json()).data).toEqual(expected);
  }
  expect((await paymentsPOST(req(path, { ...purchase, amount: "3" }))).status).toBe(409);
 });

 it("serves full policy and decision details only to the wallet that owns the vault", async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const outsider = privateKeyToAccount(generatePrivateKey());
  const store = service.store;
  const original = await service.requestPayment(DEMO_OWNER, purchase, second);
  await store.update(state => ({
    ...state,
    treasuries: state.treasuries.map(treasury => treasury.id === second ? { ...treasury, owner: signer.address } : treasury),
    policies: state.policies.map(policy => policy.treasuryId === second ? {
      ...policy, mandate: "PRIVATE_OWNER_MANDATE", perPaymentLimit: "7", weeklyBudget: "12", totalBudget: "24",
    } : policy),
    payments: state.payments.map(payment => payment.id === original.id ? { ...payment, decisionReason: "PRIVATE_OWNER_DECISION" } : payment),
  }));
  const auth = new OwnerAuth(store);
  holder.runtime = { mode: "live", store, service, auth };
  const origin = "http://localhost:3000";
  const query = "?treasuryId=" + second;
  const dashboardPath = "/api/owner/dashboard" + query;
  const paymentsPath = "/api/owner/payments" + query;
  const withCookie = (path: string, token: string) => new Request(origin + path, {
    headers: { cookie: "agentpay_session=" + token },
  });
  async function signIn(wallet: typeof signer) {
    const { nonce, message } = await auth.nonce(wallet.address, origin);
    const signature = await wallet.signMessage({ message });
    return (await auth.verify({ address: wallet.address, nonce, signature })).token;
  }
  expect((await dashboardGET(req(dashboardPath))).status).toBe(401);
  expect((await ownerPaymentsGET(req(paymentsPath))).status).toBe(401);
  expect((await dashboardGET(withCookie(dashboardPath, await signIn(outsider)))).status).toBe(404);
  const session = await signIn(signer);
  const dashboard = await (await dashboardGET(withCookie(dashboardPath, session))).json();
  expect(dashboard.data.policy).toMatchObject({
    mandate: "PRIVATE_OWNER_MANDATE", perPaymentLimit: "7", weeklyBudget: "12", totalBudget: "24",
  });
  expect(dashboard.data.payments[0].decisionReason).toBe("PRIVATE_OWNER_DECISION");
  const payments = await (await ownerPaymentsGET(withCookie(paymentsPath, session))).json();
  expect(payments.data[0].decisionReason).toBe("PRIVATE_OWNER_DECISION");
 });
 it("offers owned cards while requiring an explicit owner dashboard selection",async()=>{
  const listing=await (await agentsGET(req('/api/owner/agents'))).json();expect(listing.data.agents.map((t:{id:string})=>t.id)).toEqual([DEMO_TREASURY,second]);
  expect((await dashboardGET(req('/api/owner/dashboard'))).status).toBe(409);
  const selected=await (await dashboardGET(req('/api/owner/dashboard?treasuryId='+second))).json();expect(selected.data.treasury.id).toBe(second);
  expect((await dashboardGET(req('/api/owner/dashboard?treasuryId=invalid'))).status).toBe(400);
  expect((await dashboardGET(req('/api/owner/dashboard?treasuryId='+second+'&treasuryId='+DEMO_TREASURY))).status).toBe(400);
 });
});
