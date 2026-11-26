import { TUSD8_ADDRESS } from "@/core/types";
import { handle } from "@/server/http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { qdaySmartAccount } from "@/integrations/qday-smart-account";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(request, async (runtime) => {
    let vaultBytecode: string | undefined;
    try {
      const artifact = JSON.parse(
        await readFile(
          resolve("contracts/artifacts/AgentTreasury.json"),
          "utf8",
        ),
      );
      vaultBytecode =
        typeof artifact.bytecode === "string"
          ? artifact.bytecode
          : artifact.bytecode?.object;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      vaultBytecode = undefined;
    }
    return {
      mode: runtime.mode,
      chainId: 44005,
      token: TUSD8_ADDRESS,
      executor: process.env.AEVUM_EXECUTOR_ADDRESS ?? null,
      vaultBytecode,
      vaultDeploymentAvailable: Boolean(vaultBytecode),
      rpcUrl: "https://rpc-test.qday.info",
      explorerUrl: "https://explorer-test.qday.info",
      ...(runtime.mode === "live" && process.env.AGENTPAY_SMART_ACCOUNTS === "true"
        ? { smartAccounts: qdaySmartAccount } : {}),
    };
  });
}
