import { after } from "next/server";
import type { AtomicStore } from "../core/ports";
import { expireRequests, selectDueRequest } from "../core/queue";
import type { State } from "../core/types";
import { getRuntime, type Runtime } from "./runtime";

const dispatchCooldownMs = 120_000;
const visitCheckCooldownMs = 10_000;
const nextVisitCheck = new WeakMap<AtomicStore, number>();
const skipWake = new Error("Executor dispatch is already covered.");

function needsExecutor(state: State, now: number) {
  if ((state.executorWakeAfter ?? 0) > now || (state.workerLease?.expiresAt ?? 0) > now)
    return false;
  const swept = expireRequests(state, now);
  return swept.payments.some((payment, index) => payment !== state.payments[index]) ||
    Boolean(selectDueRequest(swept, now));
}

async function dispatchIfDue(store: AtomicStore, repository: string, credential: string) {
  if (!needsExecutor(await store.read(), Date.now())) return;
  try {
    await store.update(state => {
      const now = Date.now();
      if (!needsExecutor(state, now)) throw skipWake;
      return { ...state, executorWakeAfter: now + dispatchCooldownMs };
    });
  } catch (error) {
    if (error === skipWake) return;
    throw error;
  }

  // Keep the cooldown even when GitHub may have received a request that timed out.
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/executor.yml/dispatches`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main", inputs: { batch: "20" } }),
  });
  if (!response.ok) console.warn("AgentPay executor dispatch declined", { status: response.status });
  await response.body?.cancel();
}

export function scheduleExecutorWake(submissionRuntime?: Runtime) {
  const { GITHUB_REPOSITORY, VERCEL_GIT_PROVIDER, VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG } = process.env;
  const linkedRepository = VERCEL_GIT_PROVIDER === "github" && VERCEL_GIT_REPO_OWNER && VERCEL_GIT_REPO_SLUG
    ? `${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}` : undefined;
  const repository = GITHUB_REPOSITORY?.trim() || linkedRepository;
  const credential = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  if (process.env.AGENTPAY_MODE === "demo" || !credential ||
      !repository || !/^[A-Za-z0-9-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(repository))
    return;

  after(async () => {
    try {
      const { mode, store } = submissionRuntime ?? await getRuntime();
      if (mode !== "live") return;
      if (!submissionRuntime) {
        const now = Date.now();
        if ((nextVisitCheck.get(store) ?? 0) > now) return;
        nextVisitCheck.set(store, now + visitCheckCooldownMs);
      }
      await dispatchIfDue(store, repository, credential);
    } catch (error) {
      console.warn("AgentPay executor wake failed", {
        type: error instanceof Error ? error.name : "unknown",
      });
    }
  });
}
