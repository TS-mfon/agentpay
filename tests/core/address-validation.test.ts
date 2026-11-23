import { expect,it } from "vitest";
import { parsePayment,parsePolicy } from "../../src/core/validation";
const invalidChecksum="0x5857d41600CA608B83049938A14FA74A415535F1";
it("rejects invalid mixed-case checksums at the API payment boundary",()=>{
 expect(()=>parsePayment({recipient:invalidChecksum,amount:"0.001",service:"Utility bill",purpose:"Household utility",evidence:"",idempotencyKey:"checksum-api-test"})).toThrow(/invalid/i);
});
it("rejects invalid mixed-case checksums and zero recipients in policies",()=>{
 for(const recipient of [invalidChecksum,"0x"+"0".repeat(40)])expect(()=>parsePolicy({mandate:"Household utility bills",perPaymentLimit:"10",weeklyBudget:"40",totalBudget:"200",validUntil:1800001000,recipients:[recipient]})).toThrow(/invalid/i);
});
