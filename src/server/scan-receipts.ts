import type { Settlement } from "../core/ports";
import { scanIdPattern } from "../core/scan-types";
import type { Mode, Payment } from "../core/types";

type ReceiptCheck = { result: Promise<boolean>; until: number };
type ReceiptCache = {
  pending: number;
  entries: Map<string, ReceiptCheck>;
};

const caches = new WeakMap<Settlement, ReceiptCache>();

function receiptCheck(settlement: Settlement, payment: Payment, hash: string) {
  const cache = caches.get(settlement) ?? { pending: 0, entries: new Map<string, ReceiptCheck>() };
  caches.set(settlement, cache);
  const key = JSON.stringify([payment.id, hash, payment.requestHash, payment.decisionRef]);
  const cached = cache.entries.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  if (cache.pending >= 8) return Promise.resolve(false);
  // Delete older attempts so even changing legacy receipt references cannot
  // grow beyond the current payment capacity.
  if (cache.entries.size >= 1000) {
    for (const [entryKey, entry] of cache.entries) {
      if (entry.until !== Infinity) {
        cache.entries.delete(entryKey);
        break;
      }
    }
  }
  cache.pending++;
  const result = Promise.resolve()
    .then(() => settlement.reconcile(payment))
    .then(outcome => outcome.status === "settled" && outcome.transactionHash?.toLowerCase() === hash.toLowerCase())
    .catch(error => {
      console.warn("AgentPay Scan receipt check unavailable", { type: error instanceof Error ? error.name : "unknown" });
      return false;
    });
  cache.entries.set(key, { result, until: Infinity });
  void result.then(verified => {
    cache.pending--;
    cache.entries.set(key, { result, until: Date.now() + (verified ? 300_000 : 15_000) });
  });
  return result;
}

export async function verifiedScanReceipt(
  payment: Payment,
  mode: Mode,
  settlement: Settlement,
): Promise<string | undefined> {
  const hash = payment.transactionHash;
  if (mode !== "live" || payment.status !== "settled" || !hash || !scanIdPattern.test(hash))
    return undefined;
  if (payment.scan?.verifiedSettlementHash === hash) return hash;

  // Only a legacy detail lookup verifies on demand. Cap the response time
  // while the shared check finishes for later viewers.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const verified = await Promise.race([
      receiptCheck(settlement, payment, hash),
      new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), 4_000); }),
    ]);
    return verified ? hash : undefined;
  } finally {
    clearTimeout(timeout);
  }
}
