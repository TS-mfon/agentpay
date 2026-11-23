import {expect,test,type Page} from "@playwright/test";
const first="0x1111111111111111111111111111111111111111",second="0x2222222222222222222222222222222222222222",recipient="0x3333333333333333333333333333333333333333";
const owned=[{id:first,agentId:"0x"+"aa".repeat(32),agentName:"Mike",owner:first,executor:second,token:recipient,balance:"0.05",availableBalance:"0.03",active:true,paused:false,policyVersion:1,keyVersion:1,weeklySpent:"0",totalSpent:"0",perPaymentLimit:"10",weeklyBudget:"40",totalBudget:"200",validUntil:4102444800},{id:second,agentId:"0x"+"bb".repeat(32),agentName:"Scout",owner:first,executor:second,token:recipient,balance:"5",active:true,paused:false,policyVersion:1,keyVersion:1,weeklySpent:"0",totalSpent:"0",perPaymentLimit:"10",weeklyBudget:"40",totalBudget:"200",validUntil:4102444800}];
async function ownerFixture(page:Page){
 await page.route("**/api/owner/agents",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({success:true,data:{mode:"live",owner:first,agents:owned}})}));
 await page.route("**/api/owner/dashboard?*",route=>{
  const selected=new URL(route.request().url()).searchParams.get("treasuryId");
  const treasury=owned.find(agent=>agent.id===selected)!;
  return route.fulfill({contentType:"application/json",body:JSON.stringify({success:true,data:{mode:"live",owner:first,treasury,policy:{version:1,mandate:treasury.agentName==="Mike"?"Pay household bills including water and children transport.":"Pay research APIs only.",mandateHash:"0x"+"cd".repeat(32),recipients:[recipient],perPaymentLimit:"10",weeklyBudget:"40",totalBudget:"200",validUntil:4102444800},payments:[],services:[{id:"unapproved",name:"Unapproved research API",description:"Must not be offered",recipient:first,amount:"4",purpose:"Research",evidence:""}]}})});
 });
}
test("agents cards open their own treasury while console and history are separate pages",async({page})=>{
 await ownerFixture(page);await page.goto("/agents");
 await expect(page.getByRole("heading",{name:"Your agents.",exact:true})).toBeVisible();
 await expect(page.getByRole("link",{name:"Open Mike agent"})).toHaveAttribute("href",`/agent/${first}`);
 await page.getByRole("link",{name:"Open Mike agent"}).click();
 await expect(page.getByRole("heading",{name:"Mike",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Your vault.",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Every request has a record.",exact:true})).toHaveCount(0);
 await page.getByRole("link",{name:"Request a payment",exact:true}).click();
 await expect(page.getByLabel("Agent",{exact:true})).toHaveValue(first);
 await expect(page.getByRole("heading",{name:"Request a payment.",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Unapproved research API"})).toHaveCount(0);
 await expect(page.getByLabel("Approved recipient",{exact:true})).toHaveValue(recipient);
 await expect(page.getByText("Only these addresses are authorized for this agent.",{exact:false})).toBeVisible();
 await page.getByRole("link",{name:"Request history",exact:true}).click();
 await expect(page).toHaveURL(new RegExp("/history"));
 await page.getByLabel("Agent",{exact:true}).selectOption(second);
 await expect(page.getByText("Scout",{exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"You keep authority over the funds.",exact:true})).toHaveCount(0);
});
test("console prevents over-reserved spending and retries with the same purchase reference",async({page})=>{
 await ownerFixture(page);const bodies:unknown[]=[];
 await page.route("**/api/owner/payments?*",route=>{
  expect(new URL(route.request().url()).searchParams.get("treasuryId")).toBe(first);
  bodies.push(route.request().postDataJSON());
  return route.fulfill({status:bodies.length===1?503:200,contentType:"application/json",body:JSON.stringify(bodies.length===1?{success:false,error:{code:"SERVICE_UNAVAILABLE",message:"Temporarily unavailable."}}:{success:true,data:{id:"0x"+"ff".repeat(32),status:"queued"}})});
 });
 await page.goto(`/console?treasuryId=${first}`);
 await page.getByLabel("Service or bill",{exact:true}).fill("Water bill");
 await page.getByLabel("Amount in tUSD8",{exact:true}).fill("0.04");
 await page.getByLabel("Payment purpose",{exact:true}).fill("Pay the household water bill.");
 await page.getByRole("button",{name:"Submit payment request",exact:true}).click();
 await expect(page.getByRole("main").getByRole("alert")).toContainText("available funds");expect(bodies).toHaveLength(0);
 await page.getByLabel("Amount in tUSD8",{exact:true}).fill("0.001");
 await page.getByRole("button",{name:"Submit payment request",exact:true}).click();
 await expect(page.getByRole("button",{name:"Retry the same request",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Retry the same request",exact:true}).click();
 expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);
 await expect(page.getByText("Payment request recorded.",{exact:true})).toBeVisible();
});
test("unknown agent links reveal no owned controls and narrow console stays usable",async({page})=>{
 await ownerFixture(page);await page.goto("/agent/0x9999999999999999999999999999999999999999");
 await expect(page.getByRole("heading",{name:"Agent unavailable.",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Withdraw unused funds",exact:true})).toHaveCount(0);
 await page.setViewportSize({width:375,height:812});await page.goto(`/console?treasuryId=${first}`);
 await expect(page.getByLabel("Approved recipient",{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:".local/qa/console-mobile.png",fullPage:true});
});


test("an unavailable agent service does not show a misleading empty-account state",async({page})=>{
 await page.route("**/api/owner/agents",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({success:false,error:{code:"SERVICE_UNAVAILABLE",message:"Temporarily unavailable."}})}));
 await page.goto("/agents");
 await expect(page.getByRole("heading",{name:"The workspace is unavailable.",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Create your first agent treasury.",exact:true})).toHaveCount(0);
});


test("definitive recipient rejection lets the owner correct the request",async({page})=>{
 await ownerFixture(page);let count=0;
 await page.route("**/api/owner/payments?*",route=>{
  count++;
  return route.fulfill({status:count===1?403:200,contentType:"application/json",body:JSON.stringify(count===1?{success:false,error:{code:"RECIPIENT_NOT_ALLOWED",message:"This recipient is not approved."}}:{success:true,data:{id:"0x"+"cc".repeat(32),status:"queued"}})});
 });
 await page.goto(`/console?treasuryId=${first}`);
 await page.getByLabel("Service or bill",{exact:true}).fill("Water bill");
 await page.getByLabel("Amount in tUSD8",{exact:true}).fill("0.001");
 await page.getByLabel("Payment purpose",{exact:true}).fill("Pay the household water bill.");
 await page.getByRole("button",{name:"Submit payment request",exact:true}).click();
 await expect(page.getByLabel("Service or bill",{exact:true})).toBeEnabled();
 await expect(page.getByLabel("Approved recipient",{exact:true})).toBeEnabled();
 await page.getByLabel("Payment purpose",{exact:true}).fill("Pay the corrected household water invoice.");
 await page.getByRole("button",{name:"Submit payment request",exact:true}).click();
 await expect(page.getByText("Payment request recorded.",{exact:true})).toBeVisible();
});

test("a failed vault stays closed while the owner's healthy agent remains usable",async({page})=>{
 await ownerFixture(page);
 await page.route("**/api/owner/agents",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({success:true,data:{mode:"live",owner:first,agents:[owned[0]],unavailable:[{id:second,agentId:owned[1].agentId,agentName:"Scout",code:"VAULT_UNAVAILABLE",message:"This vault could not be verified. Retry later."}]}})}));
 await page.goto("/agents");
 await expect(page.getByRole("link",{name:"Open Mike agent"})).toBeVisible();
 await expect(page.getByRole("link",{name:"Open Scout agent"})).toHaveCount(0);
 await expect(page.getByRole("article",{name:"Scout unavailable"})).toContainText("Unavailable");
 await page.getByRole("link",{name:"Open Mike agent"}).click();
 await expect(page.getByRole("heading",{name:"Your vault.",exact:true})).toBeVisible();
 await page.goto(`/agent/${second}`);
 await expect(page.getByRole("heading",{name:"Agent verification unavailable.",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Withdraw unused funds",exact:true})).toHaveCount(0);
});

test("owner explicitly renews expired authorization without changing budget limits",async({page})=>{
 const treasury={...owned[0],active:false,validUntil:Math.floor(Date.now()/1000)-60,weeklySpent:"3",totalSpent:"8"};
 let updated:Record<string,unknown>|undefined;
 const policy={version:1,mandate:"Pay household bills including water and children transport.",mandateHash:"0x"+"cd".repeat(32),recipients:[recipient],perPaymentLimit:"10",weeklyBudget:"40",totalBudget:"200",validUntil:treasury.validUntil};
 await page.route("**/api/owner/agents",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({success:true,data:{mode:"demo",owner:first,agents:[treasury]}})}));
 await page.route("**/api/owner/dashboard?*",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({success:true,data:{mode:"demo",owner:first,treasury:{...treasury,...(updated?{active:true,policyVersion:2}:{})},policy:{...policy,...updated},payments:[],services:[]}})}));
 await page.route("**/api/owner/policy?*",route=>{updated=route.request().postDataJSON();return route.fulfill({contentType:"application/json",body:JSON.stringify({success:true,data:{}})});});
 await page.goto(`/agent/${first}`);
 await page.getByRole("button",{name:"Renew agent authority",exact:true}).click();
 await expect(page.getByRole("dialog")).toBeVisible();
 await page.getByLabel("Authorization duration in days",{exact:true}).fill("7");
 await page.getByRole("button",{name:"Save and renew authorization",exact:true}).click();
 await expect(page.getByRole("dialog")).not.toBeVisible();
 expect(updated?.validUntil).toBeGreaterThan(Math.floor(Date.now()/1000)+6*86400);
 expect(updated?.weeklyBudget).toBe("40");expect(updated?.totalBudget).toBe("200");
 expect(updated).not.toHaveProperty("weeklySpent");expect(updated).not.toHaveProperty("totalSpent");
});


test("uncertain admission stays locked if a later retry encounters a changed policy",async({page})=>{
 await ownerFixture(page);const bodies:Record<string,unknown>[]=[];
 await page.route("**/api/owner/payments?*",route=>{
  bodies.push(route.request().postDataJSON());
  return route.fulfill({status:bodies.length===1?503:409,contentType:"application/json",body:JSON.stringify({success:false,error:{code:bodies.length===1?"SERVICE_UNAVAILABLE":"POLICY_CHANGED",message:bodies.length===1?"Temporarily unavailable.":"The financial mandate changed."}})});
 });
 await page.goto(`/console?treasuryId=${first}`);
 await page.getByLabel("Service or bill",{exact:true}).fill("Water bill");
 await page.getByLabel("Amount in tUSD8",{exact:true}).fill("0.001");
 await page.getByLabel("Payment purpose",{exact:true}).fill("Pay the household water bill.");
 await page.getByRole("button",{name:"Submit payment request",exact:true}).click();
 await page.getByRole("button",{name:"Retry the same request",exact:true}).click();
 await expect(page.getByLabel("Service or bill",{exact:true})).toBeDisabled();
 await expect(page.getByRole("button",{name:"Retry the same request",exact:true})).toBeVisible();
 expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);
});
