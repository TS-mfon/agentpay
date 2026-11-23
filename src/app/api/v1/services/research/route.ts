import { handle, agent } from "../../../../../server/http";
import { AppError } from "../../../../../core/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(request, async (runtime) => {
    const identity = await agent(request, runtime);
    const paymentId = new URL(request.url).searchParams.get("paymentId");
    if (!paymentId || !/^0x[0-9a-fA-F]{64}$/.test(paymentId)) {
      throw new AppError(
        "INVALID_PAYMENT_REFERENCE",
        "Provide the payment request ID for this research purchase.",
      );
    }
    const payment = await runtime.service.getPayment(identity.owner, paymentId, identity.treasuryId);
    if (payment.status !== "settled" || payment.service !== "Research API") {
      throw new AppError(
        "PAYMENT_REQUIRED",
        "A settled Research API payment is required to retrieve this resource.",
        402,
      );
    }
    return {
      paymentId: payment.id,
      mode: runtime.mode,
      receipt: {
        requestId: payment.id,
        transactionHash: payment.transactionHash ?? null,
        decisionReference: payment.decisionRef ?? null,
        amount: payment.amount,
        recipient: payment.recipient,
        status: payment.status,
      },
      dataset: {
        kind: "sample",
        title: "Aevum integration research sample",
        description:
          "An original small demonstration dataset based on published QDay network configuration. It demonstrates delivery of a resource after payment; it is not a commercial research product.",
        records: [
          {
            topic: "Network identity",
            finding:
              "QDay Aevum Testnet uses chain ID 44005 and tQDAY as the native gas asset.",
            sources: [
              "https://github.com/qday-io/aevum-starter-kit/blob/main/packages/aevum/src/chain.ts",
            ],
          },
          {
            topic: "Settlement token",
            finding:
              "The configured tUSD8 token is 0x456569838f1d43009A91ebA4263147Afd7233483 and uses six decimals.",
            sources: [
              "https://github.com/qday-io/aevum-starter-kit/blob/main/packages/aevum/src/contracts.ts",
            ],
          },
          {
            topic: "Contract compatibility",
            finding:
              "The official starter contract toolchain targets Shanghai EVM compatibility.",
            sources: [
              "https://github.com/qday-io/aevum-starter-kit/blob/main/contracts/foundry.toml",
            ],
          },
        ],
      },
    };
  });
}
