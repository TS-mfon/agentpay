import { test, expect } from "@playwright/test";

test("landing presents AgentPay and links to the real onboarding and docs", async ({page}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", {name:"Agents in Motion"})).toBeVisible();
  await expect(page.getByText("Payment infrastructure for AI agents", {exact:true})).toBeVisible();
  await expect(page.getByRole("link", {name:"Set up your agent"}).first()).toHaveAttribute("href","/setup");
  await expect(page.getByRole("link", {name:"Documentation", exact:true})).toHaveAttribute("href","/docs");
  await page.getByRole("button",{name:"Pause story motion"}).click();
  await expect(page.locator(".ap-landing")).toHaveClass(/ap-reduced/);
  await expect(page.getByText("Independent agents.")).toBeVisible();
  await expect(page.getByRole("link",{name:"Explore the payment flow"})).toBeVisible();
  expect(await page.locator("video").getAttribute("src")).toBeNull();
});

for (const [width,height] of [[375,812],[320,568],[812,375],[568,320],[768,1024]]) {
  test(`story remains within ${width}×${height}`, async({page}) => {
    await page.setViewportSize({width,height});
    await page.goto("/");
    await expect(page.getByRole("link",{name:"Open workspace",exact:true})).toBeVisible();
    await page.waitForTimeout(5500);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const heading=await page.getByRole("heading",{name:"Agents in Motion"}).boundingBox();
    expect(heading?.width).toBeLessThanOrEqual(width);
    const label = await page.getByText("Payment infrastructure for AI agents", {exact:true}).boundingBox();
    expect(label!.y + label!.height).toBeLessThan(heading!.y);
    await page.getByRole("button",{name:"Pause story motion"}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test("reduced motion keeps all content readable without playing video",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/");
  await expect(page.locator(".ap-landing")).toHaveClass(/ap-reduced/);
  const height=await page.locator("#story").evaluate(el=>el.clientHeight);
  expect(height).toBeLessThan(5000);
  expect(await page.locator("video").getAttribute("src")).toBeNull();
});

test("docs has a usable agent guide and downloadable skill",async({page,request})=>{
  await page.goto("/docs");
  await expect(page.getByRole("heading",{level:1})).toBeVisible();
  await expect(page.getByRole("link",{name:"Download SKILL.md",exact:true})).toBeVisible();
  const response=await request.get("/docs/skill");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("name: agentpay");
});


test("section navigation reaches the corresponding visible story beat", async ({page}) => {
  await page.goto("/");
  await page.getByRole("link", {name:"How it works",exact:true}).click();
  await expect(page.getByRole("link",{name:"Explore the payment flow"})).toBeVisible();
  await expect.poll(() => page.evaluate(()=>scrollY / (document.querySelector<HTMLElement>("#story")!.offsetHeight-innerHeight))).toBeCloseTo(.20, 2);
  await page.getByRole("link", {name:"Your control",exact:true}).click();
  await expect(page.locator(".ap-landing")).toHaveClass(/ap-sky-reveal/,{timeout:15000});
});
