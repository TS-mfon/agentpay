import nextEnv from '@next/env';
import {createClient} from 'genlayer-js';
import {governanceChain} from '../src/integrations/genlayer-network';
import {getRuntime} from '../src/server/runtime';
nextEnv.loadEnvConfig(process.cwd());
const {store}=await getRuntime();
const payments=(await store.read()).payments;
const client=createClient({chain:governanceChain()});
for(const payment of payments){
 if(!payment.decisionRef)continue;
 const tx=await client.getTransaction({hash:payment.decisionRef as Parameters<typeof client.getTransaction>[0]['hash']});
 console.log(JSON.stringify({service:payment.service,requestStatus:payment.status,decisionRef:payment.decisionRef,status:tx.statusName,execution:tx.txExecutionResultName,result:tx.resultName,error:payment.error,leaderErrors:tx.consensus_data?.leader_receipt?.map(r=>r.error)}));
}
