import { z } from "zod";
import { AppError } from "@/core/errors";
import { createOwnerOperationChain } from "@/integrations/aevum-owner-receipts";
import { qdayPublicClient } from "@/integrations/qday-smart-account";
import { OwnerOperations } from "@/server/owner-operations";
import { body, handle, ownerIdentity } from "@/server/http";
import type { Runtime } from "@/server/runtime";

export const runtime = "nodejs";
const commands = z.discriminatedUnion("command", [
  z.object({ command: z.literal("submit"), intent: z.unknown(), operation: z.unknown() }),
  z.object({ command: z.literal("resume"), userOperationHash: z.string(), rebroadcast: z.boolean().optional() }),
]);

async function context(request: Request, r: Runtime, mutating: boolean) {
  if (r.mode !== "live" || process.env.AGENTPAY_SMART_ACCOUNTS !== "true")
    throw new AppError("SMART_ACCOUNTS_UNAVAILABLE", "Smart accounts are unavailable here.", 404);
  const identity = await ownerIdentity(request, r, mutating);
  if (!identity.signer)
    throw new AppError("SMART_ACCOUNT_REQUIRED", "Sign in with a QDay smart account.", 403);
  const chain = createOwnerOperationChain(qdayPublicClient(process.env.AEVUM_RPC_URL));
  return { identity, operations: new OwnerOperations(r.store, r.service, chain) };
}

export async function GET(request: Request) {
  return handle(request, async r => {
    const { identity, operations } = await context(request, r, false);
    const hash = new URL(request.url).searchParams.get("userOperationHash");
    return operations.get(identity.owner, hash ?? undefined);
  });
}

export async function POST(request: Request) {
  return handle(request, async r => {
    const { identity, operations } = await context(request, r, true);
    const result = commands.safeParse(await body(request, 32000));
    if (!result.success) throw new AppError("INVALID_OWNER_OPERATION", "Choose a signed operation or a UserOperation hash.");
    const data = result.data;
    return data.command === "submit" ? operations.submit(identity, data)
      : operations.resume(identity, data.userOperationHash, data.rebroadcast);
  });
}
