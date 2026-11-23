import { getAddress, isAddress, parseUnits } from "viem";
import type { TreasurySetup } from "./wallet";

export interface SetupForm {
  treasuryId: string;
  agentName: string;
  mandate: string;
  perPaymentLimit: string;
  weeklyBudget: string;
  totalBudget: string;
  recipients: string;
  expiryDays: string;
}
export const emptySetup: Readonly<SetupForm> = {
  treasuryId: "", agentName: "", mandate: "", perPaymentLimit: "10",
  weeklyBudget: "40", totalBudget: "200", recipients: "", expiryDays: "30",
};
export const setupSteps = ["Your agent", "Spending rules", "Permissions", "Review & create"] as const;
const amountPattern = /^(0|[1-9]\d{0,12})(\.\d{1,6})?$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export function parseRecipients(value: string): string[] {
  const supplied = value.trim().split(/[\s,]+/).filter(Boolean);
  if (!supplied.length) throw new Error("Add at least one approved recipient address.");
  const addresses = supplied.map((address) => {
    if (!addressPattern.test(address) || /^0x0{40}$/i.test(address))
      throw new Error("Each recipient must be a valid, non-zero Ethereum address.");
    if (!isAddress(address, { strict: true })) throw new Error("A recipient address has an invalid checksum. Check it before continuing.");
    try { return getAddress(address); }
    catch { throw new Error("A recipient address has an invalid checksum. Check it before continuing."); }
  });
  const unique = [...new Set(addresses)];
  if (unique.length > 30) throw new Error("Approve no more than 30 recipient addresses.");
  return unique;
}

function budgetError(form: SetupForm): string | null {
  if (form.mandate.trim().length < 20 || form.mandate.trim().length > 4000)
    return "Write a spending mandate between 20 and 4,000 characters describing the work your agent may pay for.";
  if ([form.perPaymentLimit, form.weeklyBudget, form.totalBudget].some(
    (value) => !amountPattern.test(value) || parseUnits(value, 6) <= 0n,
  )) return "Enter positive tUSD8 budgets with up to six decimal places.";
  if (parseUnits(form.perPaymentLimit, 6) > parseUnits(form.weeklyBudget, 6))
    return "Weekly budget must cover the per-payment limit.";
  if (parseUnits(form.weeklyBudget, 6) > parseUnits(form.totalBudget, 6))
    return "Lifetime budget must cover the weekly budget.";
  return null;
}

function permissionError(form: SetupForm, createNew: boolean): string | null {
  try { parseRecipients(form.recipients); }
  catch (error) { return error instanceof Error ? error.message : "Check recipient addresses."; }
  if (!/^\d+$/.test(form.expiryDays) || Number(form.expiryDays) < 1 || Number(form.expiryDays) > 90)
    return "Choose an authorization expiry between 1 and 90 whole days.";
  if (!createNew) {
    if (!addressPattern.test(form.treasuryId) || /^0x0{40}$/i.test(form.treasuryId))
      return "Enter the existing Aevum vault address.";
    if (!isAddress(form.treasuryId, { strict: true })) return "Check the existing vault address checksum.";
    try { getAddress(form.treasuryId); }
    catch { return "Check the existing vault address checksum."; }
  }
  return null;
}

export function validateSetupStep(step: number, form: SetupForm, createNew: boolean): string | null {
  if (step === 3) {
    for (const previous of [0, 1, 2]) {
      const error = validateSetupStep(previous, form, createNew);
      if (error) return error;
    }
    return null;
  }
  if (step === 0) return form.agentName.trim().length < 1 || form.agentName.trim().length > 80
    ? "Enter an agent name between 1 and 80 characters." : null;
  if (step === 1) return budgetError(form);
  return permissionError(form, createNew);
}

export function buildSetupInput(form: SetupForm, createNew: boolean, now: number): TreasurySetup {
  const error = validateSetupStep(3, form, createNew);
  if (error) throw new Error(error);
  return {
    treasuryId: form.treasuryId.trim(), agentName: form.agentName.trim(),
    mandate: form.mandate.trim(), perPaymentLimit: form.perPaymentLimit,
    weeklyBudget: form.weeklyBudget, totalBudget: form.totalBudget,
    recipients: parseRecipients(form.recipients),
    validUntil: now + Number(form.expiryDays) * 86400,
  };
}
