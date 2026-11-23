import type { AtomicStore } from '../core/ports';
interface WorkerRuntime {
  service: { processBatch(limit: number): Promise<number> };
  store: Pick<AtomicStore, 'read'> & { close?(): Promise<void> };
}
/** Close hosted-worker connections after processing; web requests retain their shared pool. */
export async function runWorkerBatch(runtime: WorkerRuntime, batch: number): Promise<number> {
  try {
    return await runtime.service.processBatch(batch);
  } finally {
    await runtime.store.close?.();
  }
}
