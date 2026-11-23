import nextEnv from '@next/env';
import {MongoClient} from 'mongodb';
nextEnv.loadEnvConfig(process.cwd());
if(!process.env.MONGODB_URI)throw new Error('Private Atlas connection is not configured');
const client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:15000,maxPoolSize:2});
try{await client.connect();await client.db('agentpay').command({ping:1});console.log('AgentPay Atlas connection verified');}catch{console.error('Atlas connection unavailable; check readiness and authorized network access. No credentials printed.');process.exitCode=1;}finally{await client.close();}
