import { handle, owner } from "../../../../server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (r) => r.service.listAgents(await owner(request, r)));
}
