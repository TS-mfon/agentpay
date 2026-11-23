import { expect, it } from "vitest";
import { emptySetup, parseRecipients, validateSetupStep } from "../../src/components/onboarding";
const invalidChecksum="0x5857d41600CA608B83049938A14FA74A415535F1";
it("rejects mistyped mixed-case recipient and vault checksums before normalization",()=>{
  expect(()=>parseRecipients(invalidChecksum)).toThrow(/checksum|valid/i);
  const form={...emptySetup,recipients:"0x2222222222222222222222222222222222222222",treasuryId:invalidChecksum};
  expect(validateSetupStep(2,form,false)).toMatch(/checksum/i);
});
