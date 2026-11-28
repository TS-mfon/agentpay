import { z } from "zod";
import { agentPaymentSchema } from "../src/core/agent-payment";

export const paymentOutput = agentPaymentSchema;
export const historyOutput = z.array(paymentOutput);
export const successOutput = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data });
