import { test, expect } from "@playwright/test";

test("governed service payment, semantic denial, withdrawal and owner controls", async ({
  page,
  request,
}) => {
  await page.goto("/workspace");
  await expect(
    page.getByText("Demo · simulated", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Discover a service. Request a payment.",
    }),
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", { name: "Research API", exact: true }),
    })
    .getByRole("button", { name: "Request payment" })
    .click();
  await page.getByRole("button", { name: "Submit payment request" }).click();
  const research = page
    .getByRole("row")
    .filter({
      has: page.getByRole("rowheader").filter({ hasText: "Research API" }),
    });
  await expect(research.getByText("Settled", { exact: true })).toBeVisible();
  await research
    .getByRole("button", { name: "View Research API request" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Simulated receipt");
  await expect(page.getByRole("dialog")).toContainText(
    "Demo simulation. No on-chain transaction.",
  );
  await page.getByRole("button", { name: "Close record" }).click();
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", {
        name: "Gaming subscription",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Request payment" })
    .click();
  await page.getByLabel("Amount in tUSD8", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Submit payment request" }).click();
  const gaming = page
    .getByRole("row")
    .filter({
      has: page
        .getByRole("rowheader")
        .filter({ hasText: "Gaming subscription" }),
    });
  await expect(gaming.getByText("Rejected", { exact: true })).toBeVisible();
  await gaming
    .getByRole("button", { name: "View Gaming subscription request" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "does not serve the research mandate",
  );
  await page.getByRole("button", { name: "Close record" }).click();
  await page
    .getByRole("button", { name: "Pause treasury", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume treasury", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Withdraw unused funds", exact: true })
    .click();
  await page.getByLabel("Amount in tUSD8", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Withdraw funds", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Unused funds withdrawn.",
  );
  await page
    .getByRole("button", { name: "Resume treasury", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause treasury", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Agent API key", exact: true })
    .click();
  await page.getByRole("button", { name: "Rotate and reveal new key" }).click();
  const key = await page.getByLabel("Copy this key now").inputValue();
  expect(key).toMatch(/^ap_/);
  const first = await request.get("/api/v1/treasury", {
    headers: { authorization: `Bearer ${key}` },
  });
  expect(first.status()).toBe(200);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Revoke agent", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Revoke agent", exact: true })
    .click();
  const revoked = await request.get("/api/v1/treasury", {
    headers: { authorization: `Bearer ${key}` },
  });
  expect(revoked.status()).toBe(401);
  await expect(
    page.getByRole("button", { name: "Authorize agent again" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Authorize agent again" }).click();
  await expect(
    page.getByRole("button", { name: "Revoke agent", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/qa/desktop.png", fullPage: true });
});

test("mobile layout and keyboard dialogs remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/workspace");
  await expect(
    page.getByRole("button", { name: "Withdraw unused funds", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Withdraw unused funds", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({ path: ".local/qa/mobile.png", fullPage: true });
});
