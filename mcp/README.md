# AgentPay MCP

The local stdio adapter exposes five tools for one owner-issued agent credential. It requires Node 22+, the repository dependencies, and a deployed AgentPay HTTPS origin. It does not need a paid server or any wallet private key.

```bash
npm ci --registry=https://registry.npmjs.org
npm run mcp
```

Set `AGENTPAY_BASE_URL` and `AGENTPAY_API_KEY` privately in the host environment. The base must be a fixed HTTPS origin without a username, password, query, fragment, or path. Explicit loopback HTTP is allowed for local development. Credentials travel only in Authorization headers to that origin; redirects are refused.

For a host running outside the checkout, point `command` directly at `/absolute/path/to/agentpay/node_modules/.bin/tsx` and `args` at `[/absolute/path/to/agentpay/mcp/server.ts]`. Supply the two environment variables in private host configuration. This uses the installed runtime rather than asking `npx` to install another version. See `/docs#mcp` for a JSON example.

| Tool | Operation |
| --- | --- |
| `agentpay_treasury` | Read this agent's vault, raw balance, pending reservations, available funds and spending state |
| `agentpay_policy` | Read mandate/version/hash, approved addresses, limits and Unix-seconds expiry; MCP adds `authorizationExpiresAt` as ISO UTC |
| `agentpay_request_payment` | Submit a governed purchase; it can spend funds after approval |
| `agentpay_payment_status` | Read a request by its AgentPay request ID, decision and settlement references |
| `agentpay_payment_history` | Read 1-100 recent requests, newest first; the limit is a local slice, not cursor pagination |

Every tool advertises an `outputSchema`. Successful results provide the same `{success: true, data}` envelope in `structuredContent` and a JSON text block. Output schemas retain documented fields and omit undeclared upstream fields, including signing bytes or credentials. A claimed settled record missing its transaction or decision reference is rejected as an invalid response; schema validation does not independently verify the chain receipt. On older APIs, missing availability fields remain unknown rather than being replaced with the raw balance.

Handler/API errors set `isError: true` and provide a structured `{success: false, error: {code, message}}` envelope. SDK input-schema failures can instead provide plain text. Clients must check `isError` before parsing content as JSON or interpreting it as successful payment data. Error messages are bounded and never forward credentials or upstream stack traces. API errors retain the actual `httpStatus` when available. `REQUEST_TIMEOUT` identifies the 15-second deadline; `NETWORK_UNAVAILABLE` indicates another connection failure. Both require original-request reconciliation before another submission.

## Purchase and recovery

Read mandate and treasury first. Use `availableBalance` and, when returned, `spendableBalance`; raw `balance` may be committed to pending requests. Choose only an address from this policy's `recipients`, and obtain owner guidance when its merchant identity or intended use is unclear. Allowlist inclusion is not vendor verification.

Persist the exact purchase body and a stable idempotency key before calling the request tool. The request response is not settlement. Poll existing request IDs every 15-30 seconds with backoff. If a submission response is lost, recover from history or resend the exact persisted body/key. A new key creates a new purchase and may duplicate a payment. No cursor pagination or idempotency-key search endpoint exists.

If a record is `failed` and contains `transactionHash`, preserve its request/key/hash and have the owner/operator verify the actual receipt and token transfers before another purchase key. A successful mined receipt can lack matching payment proof; the public record then says `failed` with a receipt-review error. This does not prove a revert or absence of token movement. The worker stops automatic rebroadcast/re-signing for that mined request. Network-unknown transactions remain `executing` and continue reconciliation.

The worker normally checks every five minutes, but scheduling and finality may take additional runs. MCP exposes no worker-health heartbeat or guaranteed next-run timestamp. Escalate a request that remains stalled across repeated expected cycles using its ID, state, attempts and expiry; do not invent a payment ETA. A network error can occur after a request was accepted.

Status `settled` supplies `transactionHash`, `treasuryId`, `agentId`, `id`, `recipient`, `amountUnits`, `policyVersion`, `requestHash`, `mandateHash`, and `decisionRef`. See [the skill's receipt map](../skills/agentpay/SKILL.md#receipt-field-map) and `/docs#receipts`. The backend requires a successful receipt with one matching vault `PaymentExecuted` event plus exactly one official tUSD8 `Transfer` from that vault to the recipient for `amountUnits`; this adapter does not independently query Aevum receipts. Use trusted explorer/RPC reads for independent verification, and state when only backend-reported verification is available.

## Boundaries and evidence

Agent credentials stay scoped to an active agent and vault even when an owner has multiple agents. The adapter provides no funding, withdrawal, policy-update or owner-control tools. Tool annotations describe side effects; API and contract checks enforce actual financial authority.

Service, purpose and evidence are sent in GenLayer transaction arguments and should be treated as disclosed to governance infrastructure. Omit personal names, home addresses, children's routes, credentials and unredacted private invoice details. An owner-authorized nominal test must be labeled as such and must not claim an actual invoice or service delivery.

API requests time out after 15 seconds, responses are limited to 1.5MB, and local calls are capped at 60 per minute. The cross-chain executor is trusted within Aevum's hard limits. Studio development state can reset, and an on-chain transfer does not establish merchant identity or fulfillment.
