import { expect, test } from "@playwright/test";
import type { ScanPaymentDetail, ScanPaymentSummary } from "../../src/core/scan-types";

const pendingId = "0x" + "8a".repeat(32);
const settledId = "0x" + "4b".repeat(32);
const legacyId = "0x" + "2c".repeat(32);
const tx = "0x" + "5d".repeat(32);

const pending: ScanPaymentSummary = {
  id: pendingId, agentName: "Research Scout", amount: "0.000013", status: "awaiting_finality",
  createdAt: "2026-11-27T11:30:00.000Z",
};
const settled: ScanPaymentDetail = {
  id: settledId, agentName: "Market Scout", amount: "0.001", status: "settled",
  createdAt: "2026-11-27T10:00:00.000Z", transactionHash: tx,
  governance: { verdict: "approved", explanation: "GenLayer approved the request under its spending mandate." },
};
const legacy: ScanPaymentDetail = {
  id: legacyId, agentName: "Data Scout", amount: "0.02", status: "needs_information",
  createdAt: "2026-11-27T09:00:00.000Z", governance: { verdict: "needs_information" },
};

test("public feed filters, loads older records, copies IDs, and opens the verified Aevum receipt", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/scan/payments**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(settledId))
      return route.fulfill({ json: { success: true, data: settled } });
    const older = url.searchParams.get("cursor") === "older";
    const onlySettled = url.searchParams.get("status") === "settled";
    return route.fulfill({
      json: { success: true, data: {
        items: older ? [legacy] : onlySettled ? [settled] : [pending, settled],
        nextCursor: older || onlySettled ? null : "older",
      } },
    });
  });
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "AgentPay Scan" })).toBeVisible();
  await expect(page.getByText("0.000013", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy request ID", exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(pendingId);

  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.getByRole("link", { name: /Data Scout request/ })).toBeVisible();
  await page.getByRole("button", { name: "Settled", exact: true }).click();
  await expect(page.getByRole("link", { name: /Research Scout request/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Market Scout request/ }).click();
  await expect(page).toHaveURL(new RegExp("/scan/" + settledId + "$"));
  await expect(page.getByRole("heading", { name: "GenLayer decision" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View payment on Aevum" })).toHaveAttribute(
    "href", "https://explorer-test.qday.info/tx/" + tx,
  );
});

test("updates a visible active card in place and stops polling after settlement", async ({ page }) => {
  await page.clock.install();
  let refreshedIds: string | null = null;
  let refreshes = 0;
  await page.route("**/api/scan/payments**", async (route) => {
    const url = new URL(route.request().url());
    const ids = url.searchParams.get("ids");
    if (ids !== null) {
      refreshedIds = ids;
      refreshes++;
    }
    const item = ids === null ? pending : { ...pending, status: "settled" };
    await route.fulfill({ json: { success: true, data: { items: [item], nextCursor: null } } });
  });

  await page.goto("/scan");
  await expect(page.getByText("Demo mode", { exact: true })).toBeVisible();
  const card = page.getByRole("article").filter({ has: page.getByRole("link", { name: /Research Scout request/ }) });
  await expect(card.getByText("Pending", { exact: true })).toBeVisible();

  await page.clock.fastForward(15_100);
  await expect(card.getByText("Settled", { exact: true })).toBeVisible();
  expect(refreshedIds).toBe(pendingId);

  await page.clock.fastForward(45_100);
  expect(refreshes).toBe(1);
});

test("accepts a pasted ID with the list off and tracks approval on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.install();
  let detailReads = 0;
  await page.route("**/api/scan/payments**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/scan/payments") return route.fulfill({
      status: 404,
      json: { success: false, error: { code: "SCAN_FEED_DISABLED", message: "Use a request ID to look up a payment." } },
    });
    detailReads++;
    const record: ScanPaymentDetail = detailReads === 1 ? pending
      : detailReads === 2 ? { ...pending, status: "approved", governance: { verdict: "approved" } }
        : { ...pending, status: "settled", transactionHash: tx, governance: { verdict: "approved" } };
    await route.fulfill({ json: { success: true, data: record } });
  });

  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "Payment requests", exact: true })).toHaveCount(0);
  const idInput = page.getByLabel("Paste a request ID");
  await idInput.fill("0x123");
  await idInput.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Enter a full AgentPay request ID." })).toBeVisible();

  await idInput.fill("  " + pendingId.toUpperCase() + " ");
  await idInput.press("Enter");
  await expect(page).toHaveURL(new RegExp("/scan/" + pendingId + "$"));
  await expect(page.getByRole("heading", { name: "Research Scout" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Awaiting finality" })).toBeVisible();

  await page.clock.fastForward(15_100);
  await expect(page.getByText("Awaiting payment on Aevum", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View payment on Aevum" })).toHaveCount(0);

  await page.clock.fastForward(15_100);
  await expect(page.getByRole("link", { name: "View payment on Aevum" })).toHaveAttribute(
    "href", "https://explorer-test.qday.info/tx/" + tx,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.clock.fastForward(45_100);
  expect(detailReads).toBe(3);
});
