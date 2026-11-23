import { handle, body, success } from "@/server/http";
import { assertOrigin } from "@/server/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(request, async (r) => {
    assertOrigin(request);
    const proof = await r.auth.verify(await body(request));
    const response = success({ owner: proof.owner });
    response.cookies.set("agentpay_session", proof.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 43200,
    });
    return response;
  });
}
