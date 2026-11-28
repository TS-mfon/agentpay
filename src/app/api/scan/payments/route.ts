import { scanList } from "../../../../server/scan";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return scanList(request);
}
