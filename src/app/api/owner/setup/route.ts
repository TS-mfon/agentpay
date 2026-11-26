import { handle, directWalletOwner, body } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(request, async (r) =>
    r.service.setup(await directWalletOwner(request, r), await body(request)),
  );
}
