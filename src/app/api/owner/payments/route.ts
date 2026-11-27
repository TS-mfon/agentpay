import { handle, owner, body, selectedTreasury } from "../../../../server/http";
import { scheduleExecutorWake } from "../../../../server/executor-wake";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (r) => (await r.service.dashboard(await owner(request, r), selectedTreasury(request))).payments);
}
export async function POST(request: Request) {
  return handle(request, async (r) => {
    const payment = await r.service.requestPayment(await owner(request, r, true), await body(request), selectedTreasury(request));
    if (payment.status === "queued") scheduleExecutorWake(r);
    return payment;
  });
}
