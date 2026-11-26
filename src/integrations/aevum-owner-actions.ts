import { concatHex, encodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, parseAbiParameters,
  zeroHash, type Address, type Hex } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import type { OwnerIntent, SignedOwnerOperation } from "../core/owner-operations";
import { hashText, units } from "../core/validation";
import { TUSD8_ADDRESS, vaultAbi } from "./aevum-config";
import { kernelAbi, qdaySmartAccount } from "./qday-smart-account";

export function agentIdFor(treasuryId: string, agentName: string) {
  return hashText(`agentpay:${treasuryId.toLowerCase()}:${agentName.trim()}`);
}

export function ownerCalls(intent: OwnerIntent, owner: string) {
  const to = getAddress(intent.treasuryId);
  const { action } = intent;
  if (action === "fund") return [{ to: TUSD8_ADDRESS, data: encodeFunctionData({
    abi: erc20Abi, functionName: "transfer", args: [to, units(intent.amount)],
  }) }];

  if (action === "withdraw") return [{ to, data: encodeFunctionData({ abi: vaultAbi,
    functionName: "withdraw", args: [getAddress(owner), units(intent.amount)],
  }) }];

  const agentId = intent.agentId as Hex;
  if (action === "revoke") return [{ to, data: encodeFunctionData({ abi: vaultAbi,
    functionName: "revokeAgent", args: [agentId],
  }) }];

  const pause = { to, data: encodeFunctionData({ abi: vaultAbi,
    functionName: "setPaused", args: [action === "pause"],
  }) };
  if (action === "pause") return [pause];
  if (!("policy" in intent)) throw new Error("A treasury mandate is required.");
  const { policy, version } = intent;
  const configure = { to, data: encodeFunctionData({ abi: vaultAbi, functionName: "configureAgent", args: [
    agentId, BigInt(version), hashText(policy.mandate), units(policy.perPaymentLimit),
    units(policy.weeklyBudget), units(policy.totalBudget), BigInt(policy.validUntil), policy.recipients.map(recipient => getAddress(recipient)),
  ] }) };
  return action === "resume" ? [pause, configure] : [configure];
}

const batchMode = `0x01${"00".repeat(31)}` as const;
const batchParameters = parseAbiParameters("(address target, uint256 value, bytes callData)[]");
export function encodeOwnerAction(intent: OwnerIntent, owner: string) {
  const calls = ownerCalls(intent, owner);
  const [first] = calls;
  const data = calls.length === 1 ? concatHex([first.to, zeroHash, first.data])
    : encodeAbiParameters(batchParameters, [calls.map(call => ({ target: call.to, value: 0n, callData: call.data }))]);
  return encodeFunctionData({ abi: kernelAbi, functionName: "execute", args: [calls.length === 1 ? zeroHash : batchMode, data] });
}

export function ownerOperationHash(operation: SignedOwnerOperation) {
  return getUserOperationHash({
    chainId: qdaySmartAccount.chainId,
    entryPointAddress: qdaySmartAccount.entryPoint,
    entryPointVersion: "0.7",
    userOperation: {
      ...operation, nonce: BigInt(operation.nonce), callGasLimit: BigInt(operation.callGasLimit),
      verificationGasLimit: BigInt(operation.verificationGasLimit), preVerificationGas: BigInt(operation.preVerificationGas),
      maxFeePerGas: BigInt(operation.maxFeePerGas), maxPriorityFeePerGas: BigInt(operation.maxPriorityFeePerGas),
    },
  });
}
