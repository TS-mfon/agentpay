import { createPublicClient, http, erc20Abi } from 'viem';
import { aevum, TUSD8_ADDRESS, TOKEN_DECIMALS } from '../src/integrations/aevum-config';
const client=createPublicClient({chain:aevum,transport:http(process.env.AEVUM_RPC_URL || aevum.rpcUrls.default.http[0],{timeout:15_000,retryCount:1})});
const [chainId,code,decimals,symbol,block]=await Promise.all([client.getChainId(),client.getCode({address:TUSD8_ADDRESS}),client.readContract({address:TUSD8_ADDRESS,abi:erc20Abi,functionName:'decimals'}),client.readContract({address:TUSD8_ADDRESS,abi:erc20Abi,functionName:'symbol'}),client.getBlockNumber()]);
if(chainId!==44005||!code||code==='0x'||decimals!==TOKEN_DECIMALS)throw new Error('Official Aevum token configuration did not verify');
console.log(JSON.stringify({verifiedAt:new Date().toISOString(),chainId,token:TUSD8_ADDRESS,decimals,symbol,block:block.toString(),rpc:aevum.rpcUrls.default.http[0],verification:'read-only network and token checks; no AgentPay deployment claimed'},null,2));
