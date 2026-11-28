"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { ApiError } from "@/components/api";
import { scanPageSize, type ScanFilter, type ScanPaymentPage, type ScanPaymentSummary } from "@/core/scan-types";
import { ScanAmount, ScanBadge, ScanRequestId, ScanTime } from "./ScanParts";
import {
  filterChoices, inFilter, isActiveStatus, scanFeed, scanIdLabel, scanStatusLabels, useScanPolling,
} from "./scan-client";

type Filter = ScanFilter | "all";
type FeedState = "loading" | "ready" | "failed" | "disabled";

function RequestCard({ payment }: { payment: ScanPaymentSummary }) {
  return (
    <article className="scan-card">
      <div className="scan-card-header">
        <h3>
          <Link
            className="scan-card-link"
            href={"/scan/" + payment.id}
            aria-label={"Open " + payment.agentName + " request " + scanIdLabel(payment.id)}
          >
            {payment.agentName}
          </Link>
        </h3>
        <ScanBadge status={payment.status} />
      </div>
      <ScanAmount amount={payment.amount} />
      <ScanTime value={payment.createdAt} />
      <div className="scan-card-footer"><ScanRequestId id={payment.id} /></div>
    </article>
  );
}

function isFeedDisabled(error: unknown) {
  return error instanceof ApiError && error.code === "SCAN_FEED_DISABLED";
}

function PaymentFeed({
  filter, changeFilter, reload,
}: {
  filter: Filter;
  changeFilter: (filter: Filter) => void;
  reload: () => void;
}) {
  const [state, setState] = useState<FeedState>("loading");
  const [page, setPage] = useState<ScanPaymentPage>({ items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const active = useRef<string[]>([]);
  const offset = useRef(0);

  useEffect(() => {
    const handler = new AbortController();
    lifetime.current = handler;
    void scanFeed({ filter }, handler.signal).then((loaded) => {
      if (handler.signal.aborted) return;
      setPage(loaded);
      setState("ready");
    }).catch((error: unknown) => {
      if (handler.signal.aborted) return;
      setState(isFeedDisabled(error) ? "disabled" : "failed");
    });
    return () => handler.abort();
  }, [filter]);

  useEffect(() => {
    active.current = page.items.filter((item) => isActiveStatus(item.status)).map((item) => item.id);
  }, [page.items]);

  const refreshActive = useCallback(async (signal: AbortSignal) => {
    const ids = active.current;
    if (!ids.length) return;

    const count = Math.min(scanPageSize, ids.length);
    const start = offset.current % ids.length;
    const batch = Array.from({ length: count }, (_, index) => ids[(start + index) % ids.length]);
    offset.current = (start + count) % ids.length;

    try {
      const refreshed = await scanFeed({ ids: batch }, signal);
      if (signal.aborted) return;
      const updates = new Map(refreshed.items.map((item) => [item.id, item]));
      setPage((current) => ({
        ...current,
        items: current.items
          .map((item) => updates.get(item.id) ?? item)
          .filter((item) => inFilter(item.status, filter)),
      }));
      setRefreshFailed(false);
    } catch (error) {
      if (signal.aborted) return;
      if (isFeedDisabled(error)) {
        setPage({ items: [], nextCursor: null });
        setState("disabled");
        return;
      }
      setRefreshFailed(true);
    }
  }, [filter]);

  useScanPolling(state === "ready" && page.items.some((item) => isActiveStatus(item.status)), refreshActive);

  async function loadMore() {
    const signal = lifetime.current?.signal;
    if (!signal || !page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const next = await scanFeed({ filter, cursor: page.nextCursor }, signal);
      if (signal.aborted) return;
      setPage((current) => {
        const known = new Set(current.items.map((item) => item.id));
        return {
          items: [...current.items, ...next.items.filter((item) => !known.has(item.id))],
          nextCursor: next.nextCursor,
        };
      });
    } catch (error) {
      if (signal.aborted) return;
      if (isFeedDisabled(error)) {
        setPage({ items: [], nextCursor: null });
        setState("disabled");
        return;
      }
      setMoreFailed(true);
    } finally {
      if (!signal.aborted) setLoadingMore(false);
    }
  }

  if (state === "disabled") return null;

  return (
    <section className="scan-feed" aria-labelledby="scan-feed-title">
      <div className="scan-feed-heading">
        <div><h2 id="scan-feed-title">Payment requests</h2><span>Newest first</span></div>
        <button className="scan-refresh" type="button" onClick={reload} disabled={state === "loading"}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      </div>
      <div className="scan-filters" role="group" aria-label="Filter by payment status">
        {(["all", ...filterChoices] as const).map((choice) => (
          <button type="button" key={choice} aria-pressed={choice === filter} onClick={() => changeFilter(choice)}>
            {choice === "all" ? "All requests" : scanStatusLabels[choice]}
          </button>
        ))}
      </div>
      {state === "loading" && <p className="scan-empty" role="status">Loading payment requests…</p>}
      {state === "failed" &&
        <div className="scan-empty" role="alert">
          <p>Couldn’t load payment requests.</p>
          <button className="scan-refresh" type="button" onClick={reload}>Try again</button>
        </div>}
      {state === "ready" && (page.items.length ? (
        <ul className="scan-card-grid">
          {page.items.map((payment) => <li key={payment.id}><RequestCard payment={payment} /></li>)}
        </ul>
      ) : <p className="scan-empty" role="status">{filter === "all" ? "No payment requests yet." : "No requests match this filter."}</p>)}
      {refreshFailed && <p className="scan-feedback" role="status">Couldn’t refresh request statuses. Scan will retry shortly.</p>}
      {moreFailed && <p className="scan-feedback" role="alert">Couldn’t load older requests. Try again.</p>}
      {page.nextCursor && <div className="scan-more">
        <button className="scan-refresh" type="button" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"} <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>}
    </section>
  );
}

export default function ScanFeed() {
  const [filter, changeFilter] = useState<Filter>("all");
  const [revision, setRevision] = useState(0);
  return <PaymentFeed
    key={filter + "/" + revision}
    filter={filter}
    changeFilter={changeFilter}
    reload={() => setRevision((previous) => previous + 1)}
  />;
}
