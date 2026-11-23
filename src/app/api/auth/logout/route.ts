import { handle, success } from "@/server/http";
import { assertOrigin } from "@/server/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(request, async (r) => {
    assertOrigin(request);
    const token = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("agentpay_session="))
      ?.slice(17);
    await r.auth.logout(token);
    const response = success({ signedOut: true });
    response.cookies.set("agentpay_session", "", {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  });
}
