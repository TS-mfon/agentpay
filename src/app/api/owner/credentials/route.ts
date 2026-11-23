import { handle, owner, body, selectedTreasury } from "../../../../server/http";
import { AppError } from "../../../../core/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(request, async (r) => {
    const identity = await owner(request, r, true);
    const data = (await body(request)) as { action?: string };
    if (data.action !== "issue" && data.action !== "rotate")
      throw new AppError("INVALID_ACTION", "Choose issue or rotate.");
    return r.service.issueCredential(identity, selectedTreasury(request));
  });
}
