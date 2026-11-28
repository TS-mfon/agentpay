import { handle, agent, body } from "../../../../server/http";
import { scheduleExecutorWake } from "../../../../server/executor-wake";
import { agentPayment } from "../../../../core/agent-payment";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (r) => {
    const identity = await agent(request, r);
    return (await r.service.listPayments(identity.owner, identity.treasuryId)).map(agentPayment);
  });
}
export async function POST(request: Request) {
  return handle(request, async (r) => {
    const identity = await agent(request, r);
    const payment = await r.service.requestPayment(identity.owner, await body(request), identity.treasuryId, identity);
    if (payment.status === "queued") scheduleExecutorWake(r);
    return agentPayment(payment);
  });
}
