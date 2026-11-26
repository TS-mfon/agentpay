import { randomBytes, createHash } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import type { AtomicStore } from "../core/ports";
import { AppError } from "../core/errors";
import { sameAddress } from "../core/validation";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export interface SmartOwnerVerifier {
  verify(owner: Address, signer: Address, message: string, signature: Hex): Promise<boolean>;
  isCurrent(owner: Address, signer: Address): Promise<boolean>;
}
export interface OwnerIdentity { owner: string; signer?: string }

export class OwnerAuth {
  constructor(
    private readonly store: AtomicStore,
    private readonly now: () => number = Date.now,
    private readonly smartOwners?: SmartOwnerVerifier,
  ) {}
  async nonce(address: string, origin: string, smartSigner?: string) {
    let owner: string;
    try {
      if (!isAddress(address, { strict: true })) throw new Error("Invalid address");
      owner = getAddress(address);
    } catch {
      throw new AppError(
        "INVALID_ADDRESS",
        "A valid wallet address is required.",
      );
    }
    let signer: Address | undefined;
    if (smartSigner !== undefined) {
      if (!this.smartOwners)
        throw new AppError("SMART_ACCOUNTS_UNAVAILABLE", "Smart accounts are unavailable here.", 403);
      if (!isAddress(smartSigner, { strict: true }) || sameAddress(smartSigner, owner) || /^0x0{40}$/i.test(smartSigner))
        throw new AppError("INVALID_ADDRESS", "A valid browser wallet signer is required.");
      signer = getAddress(smartSigner);
    }
    const nonce = randomBytes(24).toString("hex");
    const message = [
      "Sign in to AgentPay",
      `Origin: ${origin}`,
      `Wallet: ${owner}`,
      ...(signer ? [`Signer: ${signer}`] : []),
      "Network: QDay Aevum Testnet (44005)",
      `Nonce: ${nonce}`,
      `Expires: ${new Date(this.now() + 300000).toISOString()}`,
    ].join("\n");
    await this.store.update((s) => {
      const active = s.nonces.filter((n) => n.expiresAt > this.now());
      if (active.filter((n) => sameAddress(n.owner, owner)).length >= 5)
        throw new AppError("NONCE_LIMIT", "This wallet has five active sign-in challenges. Use an existing challenge or wait five minutes.", 429);
      return { ...s, nonces: [...active, { value: nonce, owner, ...(signer ? { signer } : {}), message, expiresAt: this.now() + 300000 }] };
    });
    return { nonce, message };
  }
  async verify(input: unknown) {
    if (!input || typeof input !== "object")
      throw new AppError("INVALID_REQUEST", "Wallet proof is required.");
    const { address, nonce, signature } = input as Record<string, unknown>;
    if (
      typeof address !== "string" ||
      typeof nonce !== "string" ||
      typeof signature !== "string" ||
      !/^0x(?:[0-9a-fA-F]{130}|[0-9a-fA-F]{172})$/.test(signature)
    )
      throw new AppError(
        "INVALID_SIGNATURE",
        "A valid wallet signature is required.",
      );
    const proof = (await this.store.read()).nonces.find((n) =>
      n.value === nonce && sameAddress(n.owner, address) && n.expiresAt > this.now());
    if (!proof) throw new AppError("NONCE_EXPIRED", "The sign-in challenge expired or was already used.", 401);
    const valid = proof.signer
      ? signature.length === 174 && !!this.smartOwners && await this.smartOwners.verify(
          proof.owner as Address, proof.signer as Address, proof.message, signature as Hex)
      : signature.length === 132 && await verifyMessage({
          address: proof.owner as Address,
          message: proof.message,
          signature: signature as Hex,
        }).catch(() => false);
    if (!valid)
      throw new AppError(
        "INVALID_SIGNATURE",
        "Wallet signature does not match the sign-in challenge.",
        401,
      );
    const token = randomBytes(32).toString("base64url");
    await this.store.update((s) => {
      const current = s.nonces.find((n) => n.value === nonce && n.owner === proof.owner &&
        n.message === proof.message && n.signer === proof.signer && n.expiresAt > this.now());
      if (!current) throw new AppError("NONCE_EXPIRED", "The sign-in challenge expired or was already used.", 401);
      return { ...s, nonces: s.nonces.filter((n) => n.value !== nonce), sessions: [
        ...s.sessions.filter((session) => session.expiresAt > this.now()),
        { digest: digest(token), owner: proof.owner, ...(proof.signer ? { signer: proof.signer } : {}),
          expiresAt: this.now() + 43200000 },
      ] };
    });
    return { token, owner: proof.owner, ...(proof.signer ? { signer: proof.signer } : {}) };
  }
  async owner(token: string | undefined) {
    return (await this.identity(token)).owner;
  }
  async identity(token: string | undefined, mutating = false): Promise<OwnerIdentity> {
    if (!token)
      throw new AppError(
        "UNAUTHORIZED",
        "Connect your owner wallet to continue.",
        401,
      );
    const session = (await this.store.read()).sessions.find(
      (s) => s.digest === digest(token) && s.expiresAt > this.now(),
    );
    if (!session)
      throw new AppError(
        "UNAUTHORIZED",
        "Your owner session expired. Sign in again.",
        401,
      );
    if (session.signer && (!this.smartOwners || (mutating && !await this.smartOwners.isCurrent(
      session.owner as Address, session.signer as Address,
    ))))
      throw new AppError("UNAUTHORIZED", "Reconnect the wallet that controls this smart account.", 401);
    return { owner: session.owner, ...(session.signer ? { signer: session.signer } : {}) };
  }
  async logout(token: string | undefined) {
    if (!token) return;
    await this.store.update((s) => ({
      ...s,
      sessions: s.sessions.filter(
        (session) => session.digest !== digest(token),
      ),
    }));
  }
}
export async function consumeRateLimit(
  store: AtomicStore,
  key: string,
  limit = 60,
  windowMs = 60000,
  now = Date.now(),
) {
  await store.update((s) => {
    const windows = s.rateWindows.filter((w) => w.start + windowMs > now);
    const old = windows.find((w) => w.key === key);
    if (old && old.count >= limit)
      throw new AppError(
        "RATE_LIMITED",
        "Too many requests. Wait a minute and retry.",
        429,
      );
    const next = old
      ? { ...old, count: old.count + 1 }
      : { key, start: now, count: 1 };
    return {
      ...s,
      rateWindows: [...windows.filter((w) => w.key !== key), next],
    };
  });
}
export function trustedOrigin(request: Request) {
  if (process.env.APP_ORIGIN) return new URL(process.env.APP_ORIGIN).origin;
  if (process.env.VERCEL_URL) {
    const hostname = process.env.VERCEL_URL;
    const valid =
      /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(
        hostname,
      ) && /\.vercel\.app$/i.test(hostname);
    if (!valid)
      throw new AppError(
        "CONFIGURATION_REQUIRED",
        "VERCEL_URL must be a valid Vercel deployment hostname.",
        503,
      );
    return "https://" + hostname.toLowerCase();
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.AGENTPAY_MODE === "live"
  )
    throw new AppError(
      "CONFIGURATION_REQUIRED",
      "APP_ORIGIN or a trusted Vercel deployment hostname is required for live owner authentication.",
      503,
    );
  return new URL(request.url).origin;
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== trustedOrigin(request))
    throw new AppError(
      "INVALID_ORIGIN",
      "This action must originate from the AgentPay interface.",
      403,
    );
}
