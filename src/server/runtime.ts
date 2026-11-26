import { resolve } from "node:path";
import { AgentPayService } from "../core/service";
import { emptyState, type Mode } from "../core/types";
import type { AtomicStore } from "../core/ports";
import { AppError } from "../core/errors";
import { FileStore } from "./file-store";
import { MongoStore } from "./mongo-store";
import { demoState, demoPorts } from "./demo";
import { OwnerAuth } from "./auth";
export interface Runtime {
  mode: Mode;
  store: AtomicStore;
  service: AgentPayService;
  auth: OwnerAuth;
}
let runtime: Promise<Runtime> | undefined;
async function createRuntime(options: { genlayerEndpoint?: string } = {}): Promise<Runtime> {
  const configured = process.env.AGENTPAY_MODE ?? "live";
  if (configured !== "demo" && configured !== "live")
    throw new AppError(
      "CONFIGURATION_REQUIRED",
      "AGENTPAY_MODE must be demo or live.",
      503,
    );
  const mode: Mode = configured;
  const initial = mode === "demo" ? demoState : emptyState;
  let store: AtomicStore;
  if (process.env.MONGODB_URI) {
    store = new MongoStore(
      process.env.MONGODB_URI,
      process.env.AGENTPAY_DATABASE ??
        (mode === "live" ? "agentpay" : "agentpay_demo"),
      initial,
      mode,
    );
  } else {
    if (mode === "live" || process.env.VERCEL)
      throw new AppError(
        "CONFIGURATION_REQUIRED",
        "MongoDB Atlas is required for durable hosted operation.",
        503,
      );
    store = new FileStore(
      resolve(
        /* turbopackIgnore: true */ process.env.AGENTPAY_DEMO_STATE ??
          ".local/demo-state.json",
      ),
      initial,
    );
  }
  const ports =
    mode === "demo"
      ? demoPorts()
      : (await import("../integrations/live")).createLivePorts(options);
  const smartOwners = mode === "live" && process.env.AGENTPAY_SMART_ACCOUNTS === "true"
    ? await import("../integrations/qday-smart-account") : undefined;
  return {
    mode,
    store,
    service: new AgentPayService(store, ports, mode),
    auth: new OwnerAuth(store, Date.now, smartOwners?.createSmartOwnerVerifier(
      smartOwners.qdayPublicClient(process.env.AEVUM_RPC_URL),
    )),
  };
}
export function getRuntime() {
  runtime ??= createRuntime().catch((error) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}

/** A worker owns its RPC proxy and database lifecycle; it does not change the shared web runtime. */
export function getWorkerRuntime(genlayerEndpoint: string): Promise<Runtime> {
  const endpoint = new URL(genlayerEndpoint);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port)
    throw new Error("Worker governance endpoint must be its local RPC proxy.");
  return createRuntime({ genlayerEndpoint });
}
