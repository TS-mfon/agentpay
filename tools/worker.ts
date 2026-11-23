import nextEnv from '@next/env';
const {loadEnvConfig}=nextEnv;
loadEnvConfig(process.cwd());
const batch = Number(process.env.AGENTPAY_WORKER_BATCH || '4');
if (!Number.isInteger(batch) || batch < 1 || batch > 20) throw new Error('Worker batch must be 1 to 20');
if (process.env.AGENTPAY_MODE !== 'live') throw new Error('Hosted executor requires explicit live mode');
if (!process.env.AEVUM_EXECUTOR_PRIVATE_KEY || !process.env.GENLAYER_OPERATOR_PRIVATE_KEY) throw new Error('Worker signing keys are required');
const { getRuntime } = await import('../src/server/runtime');
try {
  const { service } = await getRuntime();
  const processed = await service.processBatch(batch);
  console.log(JSON.stringify({ service:'agentpay', processed, timestamp:new Date().toISOString() }));
} catch {
  console.error('AgentPay worker failed. Inspect request status and configuration; signing data is never logged.');
  process.exitCode=1;
}
