import {expect,it} from "vitest";
import {renewalExpiry} from "../../src/components/workspace-model";
it("requires an explicit new duration when authorization has expired",()=>{
 expect(()=>renewalExpiry(1000,undefined,1001)).toThrow(/expired/i);
 expect(renewalExpiry(1000,"7",1001)).toBe(1001+7*86400);
});
it("preserves a current expiry and rejects invalid renewal durations",()=>{
 expect(renewalExpiry(10000,undefined,1001)).toBe(10000);
 for(const days of ["0","91","1.5","bad"])expect(()=>renewalExpiry(1000,days,1001)).toThrow(/1.*90/i);
});
