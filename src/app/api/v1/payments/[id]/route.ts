import { handle, agent } from "@/server/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(request, async (r) => {
    const identity = await agent(request, r);
    const { id } = await context.params;
    return r.service.getPayment(identity.owner, id);
  });
}
