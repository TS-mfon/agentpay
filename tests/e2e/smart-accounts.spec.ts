import { expect, test, type Page } from "@playwright/test";
import { encodeAbiParameters, encodeErrorResult, parseAbi } from "viem";
import { TUSD8_ADDRESS } from "../../src/integrations/aevum-config";

const chainId = 44005;
const walletAddress = "0x1111111111111111111111111111111111111111";
const predictedAddress = "0x2222222222222222222222222222222222222222";
const rpcUrl = "https://rpc-test.qday.info";
const explorerUrl = "https://explorer-test.qday.info";
const smartAccounts = {
  chainId,
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  bundlerUrl: "https://bundler.qday.info",
  factoryStaker: "0x007Cb4A07296B53eA5e53d043888230797B8FD01",
  factory: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
  implementation: "0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D",
  validator: "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57",
};

async function mockSmartAccountConfig(page: Page, enabled: boolean) {
  await page.route("**/api/config", (route) => route.fulfill({
    json: {
      success: true,
      data: {
        mode: "live",
        chainId,
        rpcUrl,
        explorerUrl,
        token: TUSD8_ADDRESS,
        executor: null,
        vaultDeploymentAvailable: false,
        ...(enabled ? { smartAccounts } : {}),
      },
    },
  }));
}

async function openWalletWelcome(page: Page, enabled: boolean) {
  await page.route("**/api/owner/agents", (route) => route.fulfill({
    status: 401,
    json: { success: false, error: { code: "UNAUTHORIZED", message: "Connect your owner wallet." } },
  }));
  await mockSmartAccountConfig(page, enabled);
  await page.goto("/setup");
  return page.getByRole("region", { name: "Start with your wallet." });
}

async function mockBrowserWallet(page: Page, options: { onAevum?: boolean; knowsAevum?: boolean; declineSwitch?: boolean } = {},
  onRequest?: (method: string) => Promise<void>) {
  const methods: string[] = [];
  await page.exposeFunction("recordSmartAccountWalletRequest", async (method: string) => {
    methods.push(method);
    await onRequest?.(method);
  });
  await page.addInitScript(({ chain, owner, options }) => {
    let selectedChain = options.onAevum ? chain : "0x1";
    let knowsAevum = options.knowsAevum;
    const browser = window as Window & {
      recordSmartAccountWalletRequest?: (method: string) => Promise<void>;
    };
    Object.defineProperty(browser, "ethereum", { value: {
      async request({ method }: { method: string }) {
        await browser.recordSmartAccountWalletRequest!(method);
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [owner];
        if (method === "eth_chainId") return selectedChain;
        if (method === "wallet_switchEthereumChain") {
          if (options.declineSwitch) throw Object.assign(new Error("Switch declined"), { code: 4001 });
          if (!knowsAevum) throw { code: -32603, data: { originalError: { code: 4902 } } };
          selectedChain = chain;
          return null;
        }
        if (method === "wallet_addEthereumChain") { knowsAevum = true; return null; }
        throw new Error(`Unexpected browser wallet request: ${method}`);
      },
    } });
  }, { chain: `0x${chainId.toString(16)}`, owner: walletAddress,
    options: { onAevum: true, knowsAevum: true, ...options } });
  return methods;
}

type RpcRequest = {
  id: number;
  method: string;
  params?: [{ to?: string; data?: string }];
};

async function mockAccountPreview(page: Page, gasBalance = "0xde0b6b3a7640000") {
  const unexpected: string[] = [];
  await page.route("**/api/auth/**", (route) => {
    unexpected.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  const rpcHosts = [new URL(rpcUrl).hostname, new URL(smartAccounts.bundlerUrl).hostname];
  await page.route((url) => rpcHosts.includes(url.hostname), (route) => {
    const request = route.request().postDataJSON() as RpcRequest | RpcRequest[];
    function reply(call: RpcRequest) {
      const response = { jsonrpc: "2.0", id: call.id };
      if (call.method === "eth_chainId") return { ...response, result: `0x${chainId.toString(16)}` };
      if (call.method === "eth_supportedEntryPoints") return { ...response, result: [smartAccounts.entryPoint] };
      if (call.method === "eth_getBalance") return { ...response, result: gasBalance };
      if (call.method === "eth_getCode") return { ...response, result: "0x" };
      const data = call.params?.[0]?.data;
      if (call.method === "eth_call" && data?.startsWith("0x48aac392")) {
        return { ...response, result: encodeAbiParameters([{ type: "address" }], [predictedAddress]) };
      }
      if (call.method === "eth_call" && data?.startsWith("0x9b249f69")) {
        return { ...response, error: {
          code: 3,
          message: "execution reverted",
          data: encodeErrorResult({
            abi: parseAbi(["error SenderAddressResult(address sender)"]),
            args: [predictedAddress],
          }),
        } };
      }
      unexpected.push(call.method);
      return { ...response, error: { code: -32601, message: `Unexpected RPC method: ${call.method}` } };
    }
    return route.fulfill({ json: Array.isArray(request) ? request.map(reply) : reply(request) });
  });
  return unexpected;
}

test("wallet onboarding keeps the standard connection without the smart-account opt-in", async ({ page }) => {
  const welcome = await openWalletWelcome(page, false);

  await expect(welcome.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
  await expect(welcome.getByRole("button", { name: "Create smart account", exact: true })).toHaveCount(0);
});

test("a signed-in wallet can open smart-account setup without signing out", async ({ page }) => {
  const methods = await mockBrowserWallet(page);
  const unexpectedRequests = await mockAccountPreview(page);
  await mockSmartAccountConfig(page, true);
  await page.route("**/api/owner/agents", route => route.fulfill({
    json: { success: true, data: { mode: "live", owner: walletAddress, ownerAccountType: "wallet", agents: [] } },
  }));
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "Your agents." })).toBeVisible();
  await page.getByRole("button", { name: "Create smart account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Set up a QDay smart account" });
  await expect(dialog.getByText(predictedAddress, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Activate smart account" })).toBeVisible();
  await expect(dialog.getByText(/existing treasuries stay with your browser wallet/i)).toBeVisible();
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your agents." })).toBeVisible();
  expect(methods.every(method => !/sign|send/i.test(method))).toBe(true);
  expect(unexpectedRequests).toEqual([]);
});

test("treasury setup identifies the active smart account and links to the explorer", async ({ page }) => {
  await mockSmartAccountConfig(page, true);
  await page.route("**/api/owner/user-operations", route => route.fulfill({ json: { success: true, data: null } }));
  await page.route("**/api/owner/agents", route => route.fulfill({
    json: { success: true, data: { mode: "live", owner: predictedAddress, ownerAccountType: "smart", ownerSigner: walletAddress, agents: [] } },
  }));
  await page.goto("/setup");
  await expect(page.getByRole("link", { name: /QDay smart account/ })).toHaveAttribute("href", `${explorerUrl}/address/${predictedAddress}`);
  await expect(page.getByText("Your Aevum smart account will own this vault.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create smart account", exact: true })).toHaveCount(0);
});

test("creating a smart account without a browser wallet reports how to proceed", async ({ page }) => {
  const welcome = await openWalletWelcome(page, true);

  await expect(welcome.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
  await welcome.getByRole("button", { name: "Create smart account", exact: true }).click();

  await expect(page.getByRole("main").getByRole("alert")).toContainText("Install a browser wallet");
});

test("smart-account preview shows its predicted address before asking to activate", async ({ page }) => {
  const walletMethods = await mockBrowserWallet(page, { onAevum: false, knowsAevum: false });
  const unexpectedRequests = await mockAccountPreview(page);
  const welcome = await openWalletWelcome(page, true);

  await welcome.getByRole("button", { name: "Create smart account", exact: true }).click();

  const main = page.getByRole("main");
  await expect(main.getByText("Smart account address", { exact: true })).toBeVisible();
  await expect(main.getByText(predictedAddress, { exact: true })).toBeVisible();
  await expect(main).toContainText("tQDAY");
  await expect(main.getByRole("button", { name: "Activate smart account", exact: true })).toBeVisible();
  expect(walletMethods).toContain("eth_requestAccounts");
  expect(walletMethods.filter(method => method.startsWith("wallet_"))).toEqual([
    "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain",
  ]);
  expect(walletMethods.every((method) => !/sign|send/i.test(method))).toBe(true);
  expect(unexpectedRequests).toEqual([]);
});

test("the workspace network shortcut adds and switches Aevum without signing in", async ({ page }) => {
  const walletMethods = await mockBrowserWallet(page, { onAevum: false, knowsAevum: false });
  const unexpectedRequests = await mockAccountPreview(page);
  await openWalletWelcome(page, true);
  await page.getByRole("button", { name: "Switch to Aevum Testnet" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("Your wallet is on Aevum Testnet");
  expect(walletMethods.filter(method => method.startsWith("wallet_"))).toEqual([
    "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain",
  ]);
  expect(walletMethods).not.toContain("eth_requestAccounts");
  expect(unexpectedRequests).toEqual([]);
});

test("declining the network switch stops wallet sign-in", async ({ page }) => {
  const walletMethods = await mockBrowserWallet(page, { onAevum: false, declineSwitch: true });
  const unexpectedRequests = await mockAccountPreview(page);
  const welcome = await openWalletWelcome(page, false);
  await welcome.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("The network switch was declined");
  expect(walletMethods).not.toContain("wallet_addEthereumChain");
  expect(walletMethods.every(method => !/sign|send/i.test(method))).toBe(true);
  expect(unexpectedRequests).toEqual([]);
});

test("treasury setup waits while the wallet confirms a network switch", async ({ page }) => {
  const confirmation = Promise.withResolvers<void>();
  await mockBrowserWallet(page, { onAevum: false }, async method => {
    if (method === "wallet_switchEthereumChain") await confirmation.promise;
  });
  await page.route("**/api/owner/agents", route => route.fulfill({
    json: { success: true, data: { mode: "live", owner: walletAddress, agents: [] } },
  }));
  await page.goto("/setup");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Switch to Aevum Testnet" }).click();
  try {
    await expect(page.getByRole("button", { name: "Waiting for confirmation…" })).toBeDisabled();
  } finally {
    confirmation.resolve();
  }
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
});

test("an unfunded smart account explains how to activate without requesting a signature", async ({ page }) => {
  const walletMethods = await mockBrowserWallet(page);
  const requests = await mockAccountPreview(page, "0x0");
  const welcome = await openWalletWelcome(page, true);
  await welcome.getByRole("button", { name: "Create smart account", exact: true }).click();
  await welcome.getByRole("button", { name: "Activate smart account", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Add tQDAY to the smart account");
  expect(walletMethods.every(method => !/sign|send/i.test(method))).toBe(true);
  expect(requests).toEqual([]);
});
