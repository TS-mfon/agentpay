import type { AtomicStore } from "../core/ports";
import { expireRequests, POLL_INTERVAL_MS, selectDueRequest } from "../core/queue";
import type { State } from "../core/types";

interface WorkerRuntime {
  service: { processBatch(limit: number): Promise<number> };
  store: Pick<AtomicStore, "read"> & { close?(): Promise<void> };
}

const continuationMs = 150_000;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const needsSweep = (state: State, swept: State) =>
  swept.payments.some((payment, index) => payment !== state.payments[index]);

function nextCheckAt(state: State, now: number) {
  return state.payments.reduce((next, payment) => {
    const availableAt = Math.max(payment.retryAt ?? 0, payment.leaseUntil ?? 0);
    const expiresAt = Date.parse(payment.expiresAt);
    return Math.min(next, availableAt > now ? availableAt : next, expiresAt > now ? expiresAt : next);
  }, now + POLL_INTERVAL_MS);
}

/** Revisit short retries within the same run while preserving its total operation cap. */
export async function runWorkerBatch(runtime: WorkerRuntime, batch: number): Promise<number> {
  const deadline = Date.now() + continuationMs;
  try {
    let processed = await runtime.service.processBatch(batch);
    while (processed < batch && Date.now() < deadline) {
      const state = await runtime.store.read();
      const now = Date.now();
      if (now >= deadline || (state.workerLease?.expiresAt ?? 0) > now) break;

      const swept = expireRequests(state, now);
      if (needsSweep(state, swept) || selectDueRequest(swept, now)) {
        const count = await runtime.service.processBatch(batch - processed);
        processed += count;
        if (count > 0) continue;
      }

      const later = expireRequests(swept, deadline - 1);
      if (!needsSweep(swept, later) && !selectDueRequest(later, deadline - 1)) break;
      const delay = Math.min(nextCheckAt(swept, now), deadline) - Date.now();
      if (delay > 0) await wait(delay);
    }
    return processed;
  } finally {
    await runtime.store.close?.();
  }
}
