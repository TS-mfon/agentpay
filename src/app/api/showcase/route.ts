import { handle } from "../../../server/http";
import { AppError } from "../../../core/errors";
import { sameAddress } from "../../../core/validation";

export const runtime = "nodejs";
const unavailable = () =>
  new AppError(
    "SHOWCASE_NOT_FOUND",
    "No public AgentPay showcase is configured.",
    404,
  );

export async function GET(request: Request) {
  return handle(request, async (runtime) => {
    const selected = process.env.AGENTPAY_SHOWCASE_TREASURY;
    if (
      runtime.mode !== "live" ||
      !selected ||
      !/^0x[0-9a-fA-F]{40}$/.test(selected)
    )
      throw unavailable();
    const state = await runtime.store.read();
    const treasury = state.treasuries.find((t) => sameAddress(t.id, selected));
    if (!treasury) throw unavailable();
    const dashboard = await runtime.service.dashboard(treasury.owner, treasury.id);
    if (!dashboard.treasury || !sameAddress(dashboard.treasury.id, selected))
      throw unavailable();
    return {
      mode: "live",
      treasuryId: dashboard.treasury.id,
      agentName: dashboard.treasury.agentName,
      balance: dashboard.treasury.balance,
      paused: dashboard.treasury.paused,
      active: dashboard.treasury.active,
      payments: dashboard.payments.slice(0, 20).map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        recipient: payment.recipient,
        status: payment.status,
        createdAt: payment.createdAt,
        policyVersion: payment.policyVersion,
        ...(payment.status === "settled" ? { transactionHash: payment.transactionHash } : {}),
      })),
    };
  });
}
