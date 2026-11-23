import { mkdir,writeFile,access } from 'node:fs/promises';
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts';
const path='.local/testnet-wallets.json';
try { await access(path); throw new Error('Testnet wallets already exist. Existing keys will not be overwritten.'); } catch(error) { if(!(error instanceof Error)||!('code' in error)||error.code!=='ENOENT')throw error; }
const deployer=generatePrivateKey(),executor=generatePrivateKey(),operator=generatePrivateKey();
const publicAddresses={deployer:privateKeyToAccount(deployer).address,executor:privateKeyToAccount(executor).address,genlayerOperator:privateKeyToAccount(operator).address};
await mkdir('.local',{recursive:true});
await writeFile(path,JSON.stringify({publicAddresses,AEVUM_DEPLOYER_PRIVATE_KEY:deployer,AEVUM_EXECUTOR_PRIVATE_KEY:executor,GENLAYER_OPERATOR_PRIVATE_KEY:operator},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify(publicAddresses,null,2));
console.log('Private keys saved only in the ignored .local directory. Fund the public addresses on the correct testnets; never publish the wallet file.');
