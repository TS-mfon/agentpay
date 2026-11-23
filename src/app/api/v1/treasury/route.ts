import { handle, agent } from "../../../../server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (r) => {
    const identity = await agent(request, r);
    return (await r.service.dashboard(identity.owner, identity.treasuryId)).treasury;
  });
}
