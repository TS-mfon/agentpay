import { verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";
import { AppError } from "../core/errors";
import { finishOwnerOperation, type OwnerIntent, type OwnerOperationRecord, type OwnerOperationStatus,
  type SignedOwnerOperation } from "../core/owner-operations";
import type { AtomicStore } from "../core/ports";
import type { AgentPayService } from "../core/service";
import { parsePolicy, policySchema, sameAddress } from "../core/validation";
import { encodeOwnerAction, ownerOperationHash } from "../integrations/aevum-owner-actions";
import { ownerNonceKey } from "../integrations/qday-smart-account";
import type { OwnerIdentity } from "./auth";

export interface OwnerOperationChain {
  check(owner: string, intent: OwnerIntent, nonce: bigint): Promise<bigint>;
  broadcast(operation: SignedOwnerOperation): Promise<Hex>;
  inspect(record: OwnerOperationRecord): Promise<
    | { status: "pending"; nextBlock: bigint }
    | { status: "verified" | "reverted" | "review"; transactionHash: Hex }
    | { status: "replaced" }
  >;
}

const hex = <T extends Hex>(regex: RegExp) => z.string().regex(regex).transform(value => value as T);
const address = hex<Address>(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0+$/.test(value));
const hashSchema = hex<Hex>(/^0x[0-9a-fA-F]{64}$/);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const vault = { treasuryId: address, agentId: hashSchema };
const intentSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...vault, action: z.literal("setup"), agentName: z.string().trim().min(1).max(80), version, policy: policySchema }),
  z.strictObject({ ...vault, action: z.enum(["policy", "resume"]), version, policy: policySchema }),
  z.strictObject({ ...vault, action: z.enum(["pause", "revoke"]), version }),
  z.strictObject({ ...vault, action: z.enum(["fund", "withdraw"]),
    amount: z.string().regex(/^(0|[1-9]\d{0,12})(\.\d{1,6})?$/).refine(value => /[1-9]/.test(value)) }),
]);
const quantity = hex<Hex>(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,31})$/);
const operationSchema = z.strictObject({
  sender: address, nonce: hex<Hex>(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/),
  callData: hex<Hex>(/^0x(?:[0-9a-fA-F]{2}){4,3800}$/), signature: hex<Hex>(/^0x[0-9a-fA-F]{130}$/),
  callGasLimit: quantity, verificationGasLimit: quantity, preVerificationGas: quantity,
  maxFeePerGas: quantity, maxPriorityFeePerGas: quantity,
});
const submissionSchema = z.object({ intent: intentSchema, operation: operationSchema });

function view(record: OwnerOperationRecord): OwnerOperationStatus {
  return { action: record.intent.action, treasuryId: record.intent.treasuryId, userOperationHash: record.hash,
    status: record.status, transactionHash: record.transactionHash, error: record.error,
    ...(record.intent.action === "setup" ? { agentName: record.intent.agentName } : {}) };
}

export class OwnerOperations {
  constructor(private readonly store: AtomicStore, private readonly service: AgentPayService,
    private readonly chain: OwnerOperationChain) {}

  private records(owner: string, records: OwnerOperationRecord[] = []) {
    return records.filter(record => sameAddress(record.owner, owner));
  }

  async get(owner: string, reference?: string) {
    const records = this.records(owner, (await this.store.read()).ownerOperations);
    if (reference !== undefined) {
      const hash = hashSchema.safeParse(reference);
      if (!hash.success) throw new AppError("INVALID_RECEIPT", "Enter a valid UserOperation hash.");
      const match = records.find(record => record.hash === hash.data.toLowerCase());
      return match ? view(match) : null;
    }
    const record = records.find(record => record.status === "pending") ?? records.at(-1);
    return record ? view(record) : null;
  }

  async submit(identity: OwnerIdentity, input: unknown): Promise<OwnerOperationStatus> {
    const body = submissionSchema.safeParse(input);
    if (!body.success || !identity.signer)
      throw new AppError("INVALID_OWNER_OPERATION", "A signed smart-account treasury operation is required.");
    const { owner, signer } = identity;
    const { operation } = body.data;
    const intent: OwnerIntent = "policy" in body.data.intent
      ? { ...body.data.intent, policy: parsePolicy(body.data.intent.policy) } : body.data.intent;
    const hash = await this.verifyOperation(owner, signer, intent, operation);
    const matches = this.records(owner, (await this.store.read()).ownerOperations);
    const existing = matches.find(record => record.hash === hash);
    if (existing) return view(existing);
    this.assertAvailable(matches);
    await this.service.checkOwnerOperation(owner, intent);
    const block = await this.chain.check(owner, intent, BigInt(operation.nonce));
    const record: OwnerOperationRecord = { owner, hash, operation, intent, status: "pending", nextBlock: block.toString() };
    let inserted = false;
    const saved = await this.store.update(state => {
      const entries = state.ownerOperations ?? [];
      const owned = this.records(owner, entries);
      inserted = !owned.some(entry => entry.hash === hash);
      if (!inserted) return state;
      this.assertAvailable(owned);
      return { ...state, ownerOperations: [...entries, record] };
    });
    const committed = this.records(owner, saved.ownerOperations).find(entry => entry.hash === hash)!;
    return inserted ? this.broadcast(committed) : view(committed);
  }

  private async verifyOperation(owner: string, signer: string, intent: OwnerIntent, operation: SignedOwnerOperation) {
    if (!sameAddress(owner, operation.sender) || BigInt(operation.nonce) >> 64n !== ownerNonceKey ||
      BigInt(operation.maxPriorityFeePerGas) > BigInt(operation.maxFeePerGas) ||
      !sameAddress(encodeOwnerAction(intent, owner), operation.callData))
      throw new AppError("INVALID_OWNER_OPERATION", "The signed operation must match this treasury action.");
    const hash = ownerOperationHash(operation);
    if (!await verifyMessage({ address: signer as Address, message: { raw: hash }, signature: operation.signature }).catch(() => false))
      throw new AppError("INVALID_SIGNATURE", "The browser wallet signature did not authorize this operation.", 401);
    return hash;
  }

  private assertAvailable(records: OwnerOperationRecord[]) {
    if (records.some(record => record.status === "pending"))
      throw new AppError("OWNER_OPERATION_PENDING", "Check the pending smart-account operation before signing another.", 409);
  }

  private async broadcast(record: OwnerOperationRecord) {
    if (!record.operation) return view(record);
    try {
      const reference = await this.chain.broadcast(record.operation);
      if (reference.toLowerCase() === record.hash) return view(record);
    } catch {
      // A bundler can accept an operation and lose the response. Preserve its exact signed envelope.
    }
    return { ...view(record), error: "Submission has not been confirmed. Check the signed operation before trying again." };
  }

  async resume(identity: OwnerIdentity, reference: string, rebroadcast = false): Promise<OwnerOperationStatus | null> {
    const { owner } = identity;
    const hash = hashSchema.safeParse(reference);
    if (!hash.success) throw new AppError("INVALID_RECEIPT", "Enter a valid UserOperation hash.");
    const record = this.records(owner, (await this.store.read()).ownerOperations)
      .find(entry => entry.hash === hash.data.toLowerCase());
    if (!record || !identity.signer) return null;
    if (record.status !== "pending") return view(record);
    const proof = await this.chain.inspect(record);
    if (proof.status === "pending") {
      const saved = BigInt(record.nextBlock) < proof.nextBlock ? await this.store.update(state => ({
        ...state, ownerOperations: state.ownerOperations?.map(entry =>
          entry.hash === record.hash && entry.status === "pending" && BigInt(entry.nextBlock) < proof.nextBlock
            ? { ...entry, nextBlock: proof.nextBlock.toString() } : entry),
      })) : await this.store.read();
      const current = this.records(owner, saved.ownerOperations).find(entry => entry.hash === record.hash) ?? record;
      return rebroadcast && current.status === "pending" ? this.broadcast(current) : view(current);
    }
    return this.finish(record, proof);
  }

  private async finish(record: OwnerOperationRecord, proof: Exclude<Awaited<ReturnType<OwnerOperationChain["inspect"]>>, { status: "pending" }>) {
    const { owner, hash, intent } = record;
    const transactionHash = "transactionHash" in proof ? proof.transactionHash : undefined;
    if (proof.status === "verified") {
      try {
        const receipt = { hash, transactionHash: proof.transactionHash, ...("version" in intent ? { version: intent.version } : {}) };
        if (intent.action === "setup") {
          await this.service.setup(owner, { ...intent.policy, treasuryId: intent.treasuryId, agentName: intent.agentName }, receipt);
        } else if (intent.action === "policy") {
          await this.service.updatePolicy(owner, intent.policy, intent.treasuryId, receipt);
        } else {
          await this.service.control(owner, intent, intent.treasuryId, receipt);
        }
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        if ((await this.get(owner, hash))?.status !== "confirmed") {
          await this.store.update(state => finishOwnerOperation(state, owner, hash, { status: "review", transactionHash,
            error: `The operation was mined. ${error.message} Refresh the treasury before signing another action.` }));
        }
      }
    } else {
      const error = proof.status === "reverted" ? "The UserOperation reverted on Aevum."
        : proof.status === "replaced" ? "Another operation used this nonce. The recorded action was not included."
          : "The mined receipt needs review before this operation can be confirmed.";
      await this.store.update(state => finishOwnerOperation(state, owner, hash, {
        status: proof.status === "review" ? "review" : "failed", transactionHash, error,
      }));
    }
    return this.get(owner, hash);
  }
}
