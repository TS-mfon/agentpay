import { scanDetail } from "../../../../../server/scan";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return scanDetail(request, (await context.params).id);
}
