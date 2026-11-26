import { afterEach, describe, expect, it, vi } from "vitest";
import { connectBrowserWallet } from "../../src/components/wallet";

const aevumId = "0xabe5";
const owner = "0x1111111111111111111111111111111111111111";
const switchedOwner = "0x2222222222222222222222222222222222222222";

function mockWallet(options: {
  chainId?: string;
  switchError?: object;
  addError?: object;
  selectOnAdd?: boolean;
  switchDoesNothing?: boolean;
  accountAfterSwitch?: string;
} = {}) {
  let chainId = options.chainId ?? "0x1";
  let added = false;
  const request = vi.fn(async ({ method }: { method: string; params?: unknown }) => {
    switch (method) {
      case "eth_requestAccounts": return [owner];
      case "eth_accounts": return [options.accountAfterSwitch ?? owner];
      case "eth_chainId": return chainId;
      case "wallet_switchEthereumChain":
        if (!added && options.switchError) throw options.switchError;
        if (!options.switchDoesNothing) chainId = aevumId;
        return null;
      case "wallet_addEthereumChain":
        if (options.addError) throw options.addError;
        added = true;
        if (options.selectOnAdd) chainId = aevumId;
        return null;
      default: throw new Error(`Unexpected wallet method ${method}`);
    }
  });
  vi.stubGlobal("window", { ethereum: { request } });
  return { request, methods: () => request.mock.calls.map(([call]) => call.method) };
}

afterEach(() => vi.unstubAllGlobals());

describe("Aevum wallet connection", () => {
  it("keeps an already active Aevum wallet connected without a network prompt", async () => {
    const wallet = mockWallet({ chainId: aevumId });
    await expect(connectBrowserWallet()).resolves.toMatchObject({ account: owner });
    expect(wallet.methods()).toEqual(["eth_requestAccounts", "eth_chainId"]);
  });

  it("switches a wallet that knows Aevum and uses the account selected on that network", async () => {
    const wallet = mockWallet({ accountAfterSwitch: switchedOwner });
    await expect(connectBrowserWallet()).resolves.toMatchObject({ account: switchedOwner });
    expect(wallet.request.mock.calls.map(([call]) => call)).toContainEqual({ method: "wallet_switchEthereumChain", params: [{ chainId: aevumId }] });
    expect(wallet.methods()).not.toContain("wallet_addEthereumChain");
  });

  it("adds Aevum from a nested mobile wallet error, then switches to it", async () => {
    const wallet = mockWallet({ switchError: { code: -32603, data: { originalError: { code: 4902 } } } });
    await expect(connectBrowserWallet()).resolves.toMatchObject({ account: owner });
    const networkRequests = wallet.request.mock.calls.map(([call]) => call).filter(call => call.method.startsWith("wallet_"));
    expect(networkRequests).toEqual([
      { method: "wallet_switchEthereumChain", params: [{ chainId: aevumId }] },
      { method: "wallet_addEthereumChain", params: [{ chainId: aevumId, chainName: "QDay Aevum Testnet",
        nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
        rpcUrls: ["https://rpc-test.qday.info"], blockExplorerUrls: ["https://explorer-test.qday.info"] }] },
      { method: "wallet_switchEthereumChain", params: [{ chainId: aevumId }] },
    ]);
  });

  it("avoids a second prompt when adding the network selects it", async () => {
    const wallet = mockWallet({ switchError: { code: 4902 }, selectOnAdd: true });
    await expect(connectBrowserWallet()).resolves.toMatchObject({ account: owner });
    expect(wallet.methods().filter(method => method === "wallet_switchEthereumChain")).toHaveLength(1);
  });

  it("stops after a declined switch and keeps the add-network prompt closed", async () => {
    const wallet = mockWallet({ switchError: { code: 4001 } });
    await expect(connectBrowserWallet()).rejects.toThrow(/network switch was declined/i);
    expect(wallet.methods()).not.toContain("wallet_addEthereumChain");
  });

  it("stops after declining to add a new network", async () => {
    const wallet = mockWallet({ switchError: { code: 4902 }, addError: { code: 4001 } });
    await expect(connectBrowserWallet()).rejects.toThrow(/adding aevum testnet was declined/i);
    expect(wallet.methods().filter(method => method === "wallet_switchEthereumChain")).toHaveLength(1);
  });

  it.each([
    { switchError: { code: 4200 } },
    { switchDoesNothing: true },
  ])("requires manual selection when the wallet stays on the original network", async options => {
    const wallet = mockWallet(options);
    await expect(connectBrowserWallet()).rejects.toThrow(/select qday aevum testnet in your wallet/i);
    expect(wallet.methods()).not.toContain("wallet_addEthereumChain");
  });
});
