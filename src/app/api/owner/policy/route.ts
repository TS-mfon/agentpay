import { handle, directWalletOwner, body, selectedTreasury } from "../../../../server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(request, async (r) => r.service.updatePolicy(await directWalletOwner(request, r), await body(request), selectedTreasury(request)));
}
