import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWorkerBatch } from '../../src/server/worker-runner';
import { emptyState } from '../../src/core/types';
import type { Payment, State } from '../../src/core/types';
import { POLL_INTERVAL_MS } from '../../src/core/queue';

const start = 1_900_000_000_000;
const pending: Payment = {
 id: 'request', treasuryId: 'vault', agentId: 'agent', policyVersion: 1,
 mandateHash: 'mandate', requestHash: 'purchase', amount: '1', amountUnits: '1000000',
 recipient: 'recipient', service: 'Research API', purpose: 'Request research data',
 evidence: '', idempotencyKey: 'worker-poll-001',
 createdAt: new Date(start).toISOString(), expiresAt: new Date(start + 3_600_000).toISOString(),
 status: 'awaiting_finality', attempts: 2, retryAt: start + POLL_INTERVAL_MS,
};

afterEach(() => vi.useRealTimers());
describe('hosted worker resource shutdown',()=>{
 it('returns completed work and closes the store so hosted runners can exit',async()=>{
  const close=vi.fn(async()=>{});
  const processBatch=vi.fn(async()=>3);
  expect(await runWorkerBatch({service:{processBatch},store:{read:async()=>emptyState(),close}},4)).toBe(3);
  expect(processBatch).toHaveBeenCalledWith(4);
  expect(close).toHaveBeenCalledOnce();
 });
 it('closes the store after a failed batch without hiding the execution failure',async()=>{
  const close=vi.fn(async()=>{});
  await expect(runWorkerBatch({service:{processBatch:async()=>{throw new Error('RPC unavailable');}},store:{read:async()=>emptyState(),close}},4)).rejects.toThrow('RPC unavailable');
  expect(close).toHaveBeenCalledOnce();
 });
 it('supports stores with no connection shutdown',async()=>{
  expect(await runWorkerBatch({service:{processBatch:async()=>0},store:{read:async()=>emptyState()}},4)).toBe(0);
 });
 it('continues a held request when it becomes due and passes only the remaining batch allowance', async () => {
  vi.useFakeTimers({ now: start });
  let state: State = { ...emptyState(), payments: [pending] };
  const close = vi.fn(async () => {});
  const processBatch = vi.fn(async () => 0)
   .mockResolvedValueOnce(1)
   .mockImplementationOnce(async () => { state = emptyState(); return 3; });
  const work = runWorkerBatch({ service: { processBatch }, store: { read: async () => state, close } }, 4);
  await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
  expect(processBatch).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await work).toBe(4);
  expect(processBatch.mock.calls).toEqual([[4], [3]]);
  expect(close).toHaveBeenCalledOnce();
 });
 it('ends within the hosted wait budget while leaving long-backoff work queued', async () => {
  vi.useFakeTimers({ now: start });
  const delayed = { ...pending, retryAt: start + 180_000 };
  const state = { ...emptyState(), payments: [delayed] };
  const processBatch = vi.fn(async () => 0);
  const close = vi.fn(async () => {});
  const work = runWorkerBatch({ service: { processBatch }, store: { read: async () => state, close } }, 4);
  await vi.advanceTimersByTimeAsync(150_000);
  expect(await work).toBe(0);
  expect(processBatch).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(state.payments).toEqual([delayed]);
 });
 it('starts a retry that becomes due during the final polling interval', async () => {
  vi.useFakeTimers({ now: start });
  const retryDelay = 145_000;
  const state = { ...emptyState(), payments: [{ ...pending, retryAt: start + retryDelay }] };
  const processBatch = vi.fn(async () => 0).mockResolvedValueOnce(1).mockResolvedValueOnce(3);
  const work = runWorkerBatch({ service: { processBatch }, store: { read: async () => state } }, 4);
  await vi.advanceTimersByTimeAsync(retryDelay - 1);
  expect(processBatch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(processBatch).toHaveBeenCalledTimes(2);
  expect(await work).toBe(4);
 });
 it('leaves due work with an executor that already holds the worker lease', async () => {
  vi.useFakeTimers({ now: start });
  const state = {
   ...emptyState(), workerLease: { token: globalThis.crypto.randomUUID(), expiresAt: start + 60_000 },
   payments: [{ ...pending, retryAt: start }],
  };
  const processBatch = vi.fn(async () => 0);
  const close = vi.fn(async () => {});
  expect(await runWorkerBatch({ service: { processBatch }, store: { read: async () => state, close } }, 4)).toBe(0);
  expect(processBatch).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
 });
});
