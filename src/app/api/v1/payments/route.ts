import { handle, agent, body } from "../../../../server/http";
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
    return r.service.requestPayment(identity.owner, await body(request), identity.treasuryId, identity);
  });
}
