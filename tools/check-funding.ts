import {readFile} from 'node:fs/promises';
import {createPublicClient,http,formatEther} from 'viem';
import {createClient} from 'genlayer-js';
import {testnetBradbury} from 'genlayer-js/chains';
import {aevum} from '../src/integrations/aevum-config';
const {publicAddresses}=JSON.parse(await readFile('.local/testnet-wallets.json','utf8'));
const a=createPublicClient({chain:aevum,transport:http(aevum.rpcUrls.default.http[0])});
for(const name of ['deployer','executor']){const balance=await a.getBalance({address:publicAddresses[name]});console.log(JSON.stringify({network:'Aevum',role:name,address:publicAddresses[name],tQDAY:formatEther(balance)}));}
const g=createClient({chain:testnetBradbury});
try{const balance=await g.getBalance({address:publicAddresses.genlayerOperator});console.log(JSON.stringify({network:testnetBradbury.name,role:'governance operator',address:publicAddresses.genlayerOperator,nativeBalance:balance.toString()}));}catch{console.log('GenLayer funding must be confirmed via its official account/faucet workflow.');}
