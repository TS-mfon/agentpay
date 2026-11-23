import { handle, owner, body } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(request, async (r) =>
    r.service.updatePolicy(await owner(request, r, true), await body(request)),
  );
}
