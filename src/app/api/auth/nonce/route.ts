import { handle } from "@/server/http";
import { consumeRateLimit, trustedOrigin } from "@/server/auth";
import { AppError } from "@/core/errors";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (r) => {
    const address = new URL(request.url).searchParams.get("address");
    if (!address)
      throw new AppError("INVALID_ADDRESS", "A wallet address is required.");
    await consumeRateLimit(r.store, "nonce:" + address.toLowerCase(), 5);
    const origin = trustedOrigin(request);
    return r.auth.nonce(address, origin);
  });
}
