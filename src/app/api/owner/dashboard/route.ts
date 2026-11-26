import { handle, ownerIdentity, selectedTreasury } from "../../../../server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (r) => {
    const identity = await ownerIdentity(request, r);
    return { ...await r.service.dashboard(identity.owner, selectedTreasury(request)),
      ownerAccountType: identity.signer ? "smart" : "wallet" };
  });
}
