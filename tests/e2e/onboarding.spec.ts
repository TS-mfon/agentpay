import { expect, test, type Page } from "@playwright/test";

async function showUnconfiguredTreasury(page: Page) {
  await page.route("**/api/owner/agents", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ success: true, data: {
      mode: "live", owner: "0x2222222222222222222222222222222222222222",
      agents: [],
    } }),
  }));
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Meet your agent." })).toBeVisible({ timeout: 20000 });
}

async function reachPermissions(page: Page) {
  await page.getByLabel("Agent name", { exact: true }).fill("Market researcher");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Spending mandate", { exact: true }).fill("Pay approved research APIs for relevant market datasets only.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose who it can pay." })).toBeVisible();
}

test("live wallet welcome has real onboarding and an actionable missing-wallet error", async ({ page }) => {
  await page.route("**/api/owner/agents", (route) => route.fulfill({
    status: 401, contentType: "application/json",
    body: JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Connect your owner wallet." } }),
  }));
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Start with your wallet." })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Demo · simulated", { exact: true })).not.toBeVisible();
  await page.locator(".welcome-content").getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Install a browser wallet");
  await expect(page.getByRole("link", { name: "Docs", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: ".local/qa/wallet-welcome.png", fullPage: true });
});

test("guided setup blocks invalid steps, preserves edits, and never deploys without a wallet", async ({ page }) => {
  await showUnconfiguredTreasury(page);
  await expect(page.getByLabel("Agent name", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("agent name");
  await page.getByLabel("Agent name", { exact: true }).fill("Market researcher");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Spending mandate", { exact: true })).toHaveValue("");
  await page.getByLabel("Spending mandate", { exact: true }).fill("Pay approved research APIs for relevant market datasets only.");
  await page.getByLabel("Per payment", { exact: false }).fill("50");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Weekly budget");
  await page.getByLabel("Per payment", { exact: false }).fill("10");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Approved recipient addresses", { exact: true }).fill("0xwrong");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("valid, non-zero");
  await page.getByLabel("Approved recipient addresses", { exact: true }).fill("0x2222222222222222222222222222222222222222");
  await page.getByLabel("Authorization expires after", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("expiry");
  await page.getByLabel("Authorization expires after", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A final look before you create." })).toBeFocused();
  await expect(page.locator(".setup-review")).toContainText("Market researcher");
  await expect(page.locator(".setup-review")).toContainText("1 address");
  await page.getByRole("button", { name: "Edit agent", exact: true }).click();
  await expect(page.getByLabel("Agent name", { exact: true })).toHaveValue("Market researcher");
  await page.getByRole("button", { name: "Review & create", exact: false }).click();
  await page.getByRole("button", { name: "Create and authorize treasury", exact: false }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Install a browser wallet");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: ".local/qa/setup-desktop.png", fullPage: true });
});

test("mobile setup remains reachable with native scrolling and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showUnconfiguredTreasury(page);
  await reachPermissions(page);
  await page.getByLabel("Approved recipient addresses", { exact: true }).fill("0x2222222222222222222222222222222222222222");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create and authorize treasury", exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".setup-fields").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: ".local/qa/setup-mobile.png", fullPage: true });
});
