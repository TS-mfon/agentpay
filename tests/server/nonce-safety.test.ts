import { expect,it } from "vitest";
import { generatePrivateKey,privateKeyToAccount } from "viem/accounts";
import { OwnerAuth } from "../../src/server/auth";
import { MemoryStore } from "../../src/server/memory-store";
import { emptyState } from "../../src/core/types";
const account=privateKeyToAccount(generatePrivateKey());
it("preserves a legitimate nonce after an invalid signature attempt",async()=>{
 const auth=new OwnerAuth(new MemoryStore(emptyState()));
 const challenge=await auth.nonce(account.address,"https://agentpay.example");
 const invalid=await account.signMessage({message:"Wrong challenge"});
 await expect(auth.verify({address:account.address,nonce:challenge.nonce,signature:invalid})).rejects.toMatchObject({code:"INVALID_SIGNATURE"});
 const signature=await account.signMessage({message:challenge.message});
 const session=await auth.verify({address:account.address,nonce:challenge.nonce,signature});
 expect(await auth.owner(session.token)).toBe(account.address);
});
it("does not let a public fresh-challenge request invalidate an earlier valid challenge",async()=>{
 const auth=new OwnerAuth(new MemoryStore(emptyState()));
 const first=await auth.nonce(account.address,"https://agentpay.example");
 await auth.nonce(account.address,"https://agentpay.example");
 const signature=await account.signMessage({message:first.message});
 expect((await auth.verify({address:account.address,nonce:first.nonce,signature})).owner).toBe(account.address);
});
it("consumes a valid nonce and creates one session atomically across concurrent verifications",async()=>{
 const store=new MemoryStore(emptyState());const auth=new OwnerAuth(store);
 const challenge=await auth.nonce(account.address,"https://agentpay.example");
 const signature=await account.signMessage({message:challenge.message});
 const input={address:account.address,nonce:challenge.nonce,signature};
 const outcomes=await Promise.allSettled([auth.verify(input),auth.verify(input)]);
 expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect((await store.read()).sessions).toHaveLength(1);
});
it("bounds each wallet to five active nonces without deleting earlier challenges",async()=>{
 let now=1800000000000;const store=new MemoryStore(emptyState());const auth=new OwnerAuth(store,()=>now);
 const first=await auth.nonce(account.address,"https://agentpay.example");
 for(let i=0;i<4;i++)await auth.nonce(account.address,"https://agentpay.example");
 await expect(auth.nonce(account.address,"https://agentpay.example")).rejects.toMatchObject({code:"NONCE_LIMIT"});
 const signature=await account.signMessage({message:first.message});
 expect((await auth.verify({address:account.address,nonce:first.nonce,signature})).owner).toBe(account.address);
 now+=300001;await auth.nonce(account.address,"https://agentpay.example");
 expect((await store.read()).nonces).toHaveLength(1);
});
