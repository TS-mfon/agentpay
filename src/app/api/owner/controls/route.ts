import { handle, directWalletOwner, body, selectedTreasury } from "../../../../server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(request, async (r) => r.service.control(await directWalletOwner(request, r), await body(request), selectedTreasury(request)));
}
