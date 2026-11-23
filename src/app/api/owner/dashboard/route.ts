import { handle, owner, selectedTreasury } from "../../../../server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (r) => r.service.dashboard(await owner(request, r), selectedTreasury(request)));
}
