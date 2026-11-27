import { handle, agent, body } from "../../../../server/http";
import { scheduleExecutorWake } from "../../../../server/executor-wake";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (r) => {
    const identity = await agent(request, r);
    return (await r.service.dashboard(identity.owner, identity.treasuryId)).payments;
  });
}
export async function POST(request: Request) {
  return handle(request, async (r) => {
    const identity = await agent(request, r);
    const payment = await r.service.requestPayment(identity.owner, await body(request), identity.treasuryId, identity);
    if (payment.status === "queued") scheduleExecutorWake(r);
    return payment;
  });
}
