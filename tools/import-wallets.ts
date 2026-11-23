import {readFile,writeFile} from 'node:fs/promises';
const wallets=JSON.parse(await readFile('.local/testnet-wallets.json','utf8'));
let content='';try{content=await readFile('.env.local','utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const values={AEVUM_DEPLOYER_PRIVATE_KEY:wallets.AEVUM_DEPLOYER_PRIVATE_KEY,AEVUM_EXECUTOR_PRIVATE_KEY:wallets.AEVUM_EXECUTOR_PRIVATE_KEY,GENLAYER_OPERATOR_PRIVATE_KEY:wallets.GENLAYER_OPERATOR_PRIVATE_KEY,AEVUM_EXECUTOR_ADDRESS:wallets.publicAddresses.executor};
for(const [name,value] of Object.entries(values)){if(typeof value!=='string')throw new Error('Invalid local wallet record');content=content.split('\n').filter(line=>!line.startsWith(name+'=')).join('\n').trimEnd()+'\n'+name+'='+JSON.stringify(value)+'\n';}
await writeFile('.env.local',content,{mode:0o600});
console.log('Imported dedicated keys into ignored local configuration; no key values printed.');
