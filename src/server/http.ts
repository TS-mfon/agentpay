import { isAddress, getAddress } from "viem";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError } from "../core/errors";
import { getRuntime, type Runtime } from "./runtime";
import { consumeRateLimit, assertOrigin } from "./auth";
import { DEMO_OWNER } from "./demo";
export const success = (data: unknown, status = 200) =>
  NextResponse.json(
    { success: true, data },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
export async function handle(
  request: Request,
  handler: (runtime: Runtime) => Promise<unknown>,
) {
  try {
    const runtime = await getRuntime();
    const identifier = createHash("sha256")
      .update(
        request.headers.get("authorization") ??
          request.headers.get("cookie") ??
          request.headers.get("x-forwarded-for") ??
          "public",
      )
      .digest("hex");
    await consumeRateLimit(runtime.store, "global", 600);
    await consumeRateLimit(
      runtime.store,
      identifier + ":" + new URL(request.url).pathname,
      60,
    );
    const result = await handler(runtime);
    return result instanceof Response ? result : success(result);
  } catch (error) {
    if (error instanceof AppError)
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    console.error("AgentPay request failed", {
      type: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "AgentPay is temporarily unavailable. Retry shortly.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function owner(
  request: Request,
  runtime: Runtime,
  mutating = false,
) {
  return (await ownerIdentity(request, runtime, mutating)).owner;
}

export async function ownerIdentity(request: Request, runtime: Runtime, mutating = false) {
  if (mutating) assertOrigin(request);
  if (runtime.mode === "demo") return { owner: DEMO_OWNER };
  const cookies = request.headers.get("cookie") ?? "";
  const token = cookies
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("agentpay_session="))
    ?.slice("agentpay_session=".length);
  return runtime.auth.identity(token);
}

export async function directWalletOwner(request: Request, runtime: Runtime) {
  const identity = await ownerIdentity(request, runtime, true);
  if (identity.signer) throw new AppError("SMART_ACCOUNT_OPERATION_REQUIRED", "Use the smart-account treasury controls.", 409);
  return identity.owner;
}
export async function agent(request: Request, runtime: Runtime) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer "))
    throw new AppError(
      "UNAUTHORIZED",
      "A Bearer agent credential is required.",
      401,
    );
  return runtime.service.authenticateAgent(header.slice(7));
}
export async function body(request: Request, maxBytes = 16000) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("INVALID_CONTENT_TYPE", "Send application/json.");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError(
          "REQUEST_TOO_LARGE",
          `Request body exceeds ${maxBytes / 1000}KB.`,
          413,
        );
      }
      chunks.push(chunk.value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.");
  }
}

export function selectedTreasury(request: Request): string | undefined {
  const parameters = new URL(request.url).searchParams;
  const supplied = parameters.getAll("treasuryId");
  if (!supplied.length) return undefined;
  if (supplied.length !== 1 || !isAddress(supplied[0], { strict: true }))
    throw new AppError("INVALID_TREASURY", "Choose a valid agent treasury address.", 400);
  return getAddress(supplied[0]);
}
