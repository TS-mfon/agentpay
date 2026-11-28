import { isIP } from "node:net";
import { AppError } from "../core/errors";
import {
  scanFilters,
  scanIdPattern,
  scanPageSize,
  type ScanFilter,
  type ScanPaymentDetail,
  type ScanPaymentPage,
  type ScanPaymentSummary,
} from "../core/scan-types";
import type { Payment, PaymentVerdict, State } from "../core/types";
import { success } from "./http";
import { getRuntime } from "./runtime";
import { verifiedScanReceipt } from "./scan-receipts";

type Position = { time: number; id: string };
type ListQuery =
  | { ids: ReadonlySet<string> }
  | { cursor?: Position; status?: ScanFilter; limit: number };

const invalidQuery = () =>
  new AppError("INVALID_SCAN_QUERY", "Use a valid Scan filter, cursor, limit, or ID list.");

function comparePosition(a: Position, b: Position) {
  return b.time - a.time || a.id.localeCompare(b.id);
}

function position(payment: Payment): Position {
  return { time: Date.parse(payment.createdAt) || 0, id: payment.id.toLowerCase() };
}

function encodeCursor(position: Position): string {
  return Buffer.from(JSON.stringify([position.time, position.id])).toString("base64url");
}

function decodeCursor(value: string): Position {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw invalidQuery();
  try {
    const pair: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(pair) || pair.length !== 2) throw invalidQuery();
    const [time, id] = pair;
    if (!Number.isSafeInteger(time) || typeof id !== "string" || !scanIdPattern.test(id))
      throw invalidQuery();
    const cursor = { time, id: id.toLowerCase() };
    if (encodeCursor(cursor) !== value) throw invalidQuery();
    return cursor;
  } catch {
    throw invalidQuery();
  }
}

function listQuery(params: URLSearchParams): ListQuery {
  const keys = ["cursor", "status", "limit", "ids"];
  if ([...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length > 1))
    throw invalidQuery();

  const suppliedIds = params.get("ids");
  if (suppliedIds !== null) {
    if (params.size !== 1 || suppliedIds.length > scanPageSize * 67) throw invalidQuery();
    const ids = suppliedIds.split(",");
    if (ids.length > scanPageSize || ids.some(id => !scanIdPattern.test(id))) throw invalidQuery();
    return { ids: new Set(ids.map(id => id.toLowerCase())) };
  }

  const status = params.get("status");
  const limit = params.get("limit");
  const cursor = params.get("cursor");
  if ((status !== null && !Object.hasOwn(scanFilters, status)) ||
      (limit !== null && (!/^[1-9][0-9]?$/.test(limit) || Number(limit) > scanPageSize)))
    throw invalidQuery();
  return {
    status: (status ?? undefined) as ScanFilter | undefined,
    limit: limit === null ? 12 : Number(limit),
    cursor: cursor === null ? undefined : decodeCursor(cursor),
  };
}

function summary(payment: Payment, agentName?: string): ScanPaymentSummary {
  return {
    id: payment.id,
    agentName: agentName || "Agent",
    amount: payment.amount,
    status: payment.status,
    createdAt: payment.createdAt,
  };
}

function pageFor(state: State, query: ListQuery): ScanPaymentPage {
  const names = new Map(state.treasuries.map(t => [t.id.toLowerCase(), t.agentName]));
  const ordered = state.payments.map(payment => ({ payment, position: position(payment) }));
  const matches = "ids" in query
    ? ordered.filter(row => query.ids.has(row.position.id))
    : ordered.filter(row => {
        const statuses: readonly Payment["status"][] | undefined = query.status && scanFilters[query.status];
        return (!statuses || statuses.includes(row.payment.status)) &&
          (!query.cursor || comparePosition(row.position, query.cursor) > 0);
      });
  matches.sort((a, b) => comparePosition(a.position, b.position));
  const page = "ids" in query ? matches : matches.slice(0, query.limit);
  return {
    items: page.map(({ payment }) => summary(payment, names.get(payment.treasuryId.toLowerCase()))),
    nextCursor: page.length < matches.length ? encodeCursor(page[page.length - 1].position) : null,
  };
}

// Public reads use a bounded window per process instead of rewriting the
// shared payment document for every visitor's refresh.
let minute = -1;
let total = 0;
const clientCounts = new Map<string, number>();
function limitScanReads(request: Request) {
  const now = Math.floor(Date.now() / 60_000);
  if (minute !== now) {
    minute = now;
    clientCounts.clear();
    total = 0;
  }
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",", 1)[0]?.trim();
  const client = address && isIP(address) ? address : "local";
  const count = clientCounts.get(client) ?? 0;
  if (total >= 1200 || count >= 90)
    throw new AppError("RATE_LIMITED", "Too many Scan requests. Wait a minute and retry.", 429);
  total++;
  clientCounts.set(client, count + 1);
}

async function scanResponse(request: Request, read: () => Promise<ScanPaymentPage | ScanPaymentDetail>) {
  try {
    limitScanReads(request);
    return success(await read());
  } catch (failure) {
    const error = failure instanceof AppError ? failure : new AppError(
      "SERVICE_UNAVAILABLE",
      "AgentPay Scan is temporarily unavailable. Retry shortly.",
      503,
    );
    if (!(failure instanceof AppError))
      console.error("AgentPay Scan read failed", { type: failure instanceof Error ? failure.name : "unknown" });
    return Response.json(
      { success: false, error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        ...(error.status === 429 ? { "Retry-After": "60" } : {}) } },
    );
  }
}

export function scanList(request: Request) {
  return scanResponse(request, async () => {
    if (process.env.AGENTPAY_SCAN_FEED === "false")
      throw new AppError("SCAN_FEED_DISABLED", "Use a request ID to look up a payment.", 404);
    const query = listQuery(new URL(request.url).searchParams);
    const { store } = await getRuntime();
    return pageFor(await store.read(), query);
  });
}

const explanations: Record<PaymentVerdict, string> = {
  approved: "The request passed policy review.",
  rejected: "Policy review found that this request fell outside the permitted spending rules.",
  needs_information: "More supporting evidence is needed before this request can be approved.",
};

function recordedVerdict(payment: Payment): PaymentVerdict | undefined {
  const { status } = payment;
  if (status === "rejected" || status === "needs_information") return status;
  if (status === "approved" || status === "executing" || status === "settled") return "approved";
  if ((status === "expired" || status === "failed") &&
      (payment.scan?.verdict === "approved" || (payment.approvalExpiresAt && payment.decisionRef)))
    return "approved";
}

function failureStage(payment: Payment): ScanPaymentDetail["failureStage"] {
  if (payment.status !== "failed") return undefined;
  const stage = payment.scan?.failureStage;
  if (stage === "validation" || stage === "governance" || stage === "settlement") return stage;
  if (payment.transactionHash || payment.rawTransaction) return "settlement";
  if (payment.decisionRef || payment.policyRegistration) return "governance";
}

export function scanDetail(request: Request, id: string) {
  return scanResponse(request, async () => {
    if (!scanIdPattern.test(id))
      throw new AppError("INVALID_REQUEST_ID", "Enter a full AgentPay request ID.");
    const { store, mode, service } = await getRuntime();
    const state = await store.read();
    const payment = state.payments.find(p => p.id.toLowerCase() === id.toLowerCase());
    if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "Payment request was not found.", 404);
    const treasury = state.treasuries.find(t => t.id.toLowerCase() === payment.treasuryId.toLowerCase());
    const verdict = recordedVerdict(payment);
    const governance = verdict ? {
      verdict,
      explanation: payment.scan?.verdict === verdict ? explanations[verdict] : undefined,
    } : undefined;
    return {
      ...summary(payment, treasury?.agentName),
      expiresAt: payment.status === "expired" ? payment.expiresAt : undefined,
      governance,
      failureStage: failureStage(payment),
      transactionHash: await verifiedScanReceipt(payment, mode, service.ports.settlement),
    };
  });
}
