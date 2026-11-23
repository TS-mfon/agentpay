import nextEnv from '@next/env';
import {createClient,createAccount} from 'genlayer-js';
import {governanceChain} from '../src/integrations/genlayer-network';
import {isHex} from 'viem';
nextEnv.loadEnvConfig(process.cwd());
const chain=governanceChain();
if(chain.id!==61997)throw new Error('Funding helper is restricted to the requested Studio-dev preview.');
const key=process.env.GENLAYER_OPERATOR_PRIVATE_KEY;
if(!key||!isHex(key)||key.length!==66)throw new Error('Configure the dedicated Studio operator key.');
const account=createAccount(key);
const client=createClient({chain,account});
const estimate=await client.estimateTransactionFees();
if(estimate.feeValue<=0n)throw new Error('Studio fee estimate was not positive.');
const amount=estimate.feeValue*20n;
if(amount>1000n*10n**18n)throw new Error('Unexpectedly large Studio fee estimate; inspect network policy.');
const before=await client.getBalance({address:account.address});
if(before>=amount){console.log(`Studio operator already has ${before} base units; estimated fee ${estimate.feeValue}.`);process.exit(0);}
let hash:unknown;
if(amount<=BigInt(Number.MAX_SAFE_INTEGER)) {
  hash=await client.request({method:'sim_fundAccount',params:[account.address,Number(amount)]});
} else {
  const body=`{"jsonrpc":"2.0","id":1,"method":"sim_fundAccount","params":["${account.address}",${amount.toString()}]}`;
  const response=await fetch(chain.rpcUrls.default.http[0],{method:'POST',headers:{'Content-Type':'application/json'},body});
  const result=await response.json() as {result?:unknown;error?:{message?:string}};
  if(result.error||!response.ok)throw new Error(result.error?.message||'Studio faucet request failed');
  hash=result.result;
}
console.log(JSON.stringify({network:chain.name,chainId:chain.id,address:account.address,estimatedExecutionFee:estimate.feeValue.toString(),fundingBaseUnits:amount.toString(),fundingTransaction:hash}));
