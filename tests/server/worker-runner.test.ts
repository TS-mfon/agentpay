import { describe, expect, it, vi } from 'vitest';
import { runWorkerBatch } from '../../src/server/worker-runner';
import { emptyState } from '../../src/core/types';
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
});
