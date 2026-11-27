import { AppError } from "../../../../core/errors";
import { assertOrigin } from "../../../../server/auth";
import { scheduleExecutorWake } from "../../../../server/executor-wake";

export const runtime = "nodejs";

export function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const site = request.headers.get("sec-fetch-site");
  if ((site && site !== "same-origin") || request.headers.has("content-type") ||
      (request.headers.get("content-length") ?? "0") !== "0")
    return new Response(null, { status: 403, headers });

  try {
    assertOrigin(request);
  } catch (error) {
    return new Response(null, { status: error instanceof AppError ? error.status : 503, headers });
  }

  scheduleExecutorWake();
  return new Response(null, { status: 204, headers });
}
