import { isAddress } from "viem";
import { z } from "zod";
import type { Ports } from "../core/ports";
import { createAevumSettlement } from "./aevum";
import { createGenLayerGovernance } from "./genlayer";
const serviceSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(80),
      name: z.string().min(1).max(120),
      description: z.string().max(1000),
      recipient: z.string().refine(isAddress),
      amount: z.string().regex(/^(0|[1-9]\d{0,12})(\.\d{1,6})?$/),
      purpose: z.string().min(3).max(1000),
      evidence: z.string().max(4000),
    }),
  )
  .max(30);
export function createLivePorts(): Ports {
  if (
    !process.env.AEVUM_EXECUTOR_ADDRESS ||
    !isAddress(process.env.AEVUM_EXECUTOR_ADDRESS)
  )
    throw new Error("Configure public AEVUM_EXECUTOR_ADDRESS");
  const services = serviceSchema.parse(
    JSON.parse(process.env.AGENTPAY_SERVICES_JSON || "[]"),
  );
  return {
    governance: createGenLayerGovernance(),
    settlement: createAevumSettlement(),
    services,
  };
}
