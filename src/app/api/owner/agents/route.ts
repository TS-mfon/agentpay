import { handle, ownerIdentity } from "../../../../server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (r) => {
    const identity = await ownerIdentity(request, r);
    return { ...await r.service.listAgents(identity.owner), ownerAccountType: identity.signer ? "smart" : "wallet",
      ...(identity.signer ? { ownerSigner: identity.signer } : {}) };
  });
}
