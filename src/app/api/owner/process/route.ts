import { handle, owner } from "@/server/http";
import { AppError } from "@/core/errors";
export const runtime = "nodejs";
export const maxDuration = 20;
export async function POST(request: Request) {
  return handle(request, async (r) => {
    const identity = await owner(request, r, true);
    if (r.mode !== "demo")
      throw new AppError(
        "WORKER_REQUIRED",
        "Live requests are processed by the configured GitHub Actions executor.",
        409,
      );
    const processed = await r.service.processBatch(12);
    return { processed, dashboard: await r.service.dashboard(identity) };
  });
}
