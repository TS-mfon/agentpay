import { readFile } from "node:fs/promises";
import { join } from "node:path";
export const runtime = "nodejs";
export async function GET() {
  const text = await readFile(join(process.cwd(), "skills", "agentpay", "SKILL.md"), "utf8");
  return new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="SKILL.md"', "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
