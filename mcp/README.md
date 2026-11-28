# AgentPay MCP

The AgentPay 0.3.0 stdio adapter exposes payment submission, status, history, and settlement references for one owner-issued credential. It runs locally with Node 22+, the repository dependencies, and a deployed AgentPay HTTPS origin.

```bash
npm ci --registry=https://registry.npmjs.org
npm run mcp
```

Set `AGENTPAY_BASE_URL` and `AGENTPAY_API_KEY` privately in the host environment. The base must be a fixed HTTPS origin without a username, password, query, fragment, or path. Explicit loopback HTTP is allowed for local development. Credentials travel only in Authorization headers to that origin; redirects are refused.

For a host running outside the checkout, point `command` directly at `/absolute/path/to/agentpay/node_modules/.bin/tsx` and `args` at `[/absolute/path/to/agentpay/mcp/server.ts]`. Supply the two environment variables in private host configuration. This uses the installed runtime rather than asking `npx` to install another version. See `/docs#mcp` for a JSON example.

| Tool | Operation |
| --- | --- |
| `agentpay_request_payment` | Submit a governed purchase that can spend funds after approval |
| `agentpay_payment_status` | Read payment status and any Aevum transaction reference by AgentPay request ID |
| `agentpay_payment_history` | Read 1–100 recent requests, newest first, using a local result limit |

Every tool advertises an `outputSchema`. Successful results provide the same `{success: true, data}` envelope in `structuredContent` and a JSON text block. The adapter returns the documented payment fields from both current and older APIs. A settled payment with an Aevum transaction hash must include its `requestHash` purchase binding. Check the chain receipt independently before reporting settlement.

Handler/API errors set `isError: true` and provide a structured `{success: false, error: {code, message}}` envelope. SDK input-schema failures can instead provide plain text. Clients must check `isError` before parsing content as JSON or interpreting it as successful payment data. Error messages are bounded and never forward credentials or upstream stack traces. API errors retain the actual `httpStatus` when available. `REQUEST_TIMEOUT` identifies the 15-second deadline; `NETWORK_UNAVAILABLE` indicates another connection failure. Both require original-request reconciliation before another submission.

## Purchase and recovery

Ask the owner to confirm the approved recipient and amount. Owners sign in with their wallet to review the mandate, budgets, per-payment limit, and full decision explanations. AgentPay 0.3.0 retires `agentpay_treasury` and `agentpay_policy`.

Persist the exact purchase body and a stable idempotency key before calling the request tool. The request response is not settlement. Poll existing request IDs every 15-30 seconds with backoff. If a submission response is lost, recover from history or resend the exact persisted body/key. A new key creates a new purchase and may duplicate a payment. No cursor pagination or idempotency-key search endpoint exists.

If an `executing` or `failed` record contains `transactionHash`, preserve its request ID, purchase key, and hash for reconciliation. Have the owner or operator verify the receipt and token transfers before creating another purchase key. A mined transaction can move funds even when settlement verification fails. The worker stops automatic rebroadcast for that mined request and continues reconciling unresolved transactions.

Configured deployments ask GitHub to start the executor after payment submission. Scheduling and finality can delay processing. MCP exposes no worker-health heartbeat or guaranteed next-run timestamp. Escalate a request that remains stalled across repeated expected cycles using its ID, state, attempts and expiry; do not invent a payment ETA. A network error can occur after a request was accepted.

For a live `settled` payment, use `transactionHash`, `treasuryId`, `agentId`, `id`, `recipient`, `amountUnits`, `policyVersion`, and `requestHash` to verify settlement. A simulated payment can reach `settled` and omits the on-chain receipt. The backend checks for one matching vault `PaymentExecuted` event and exactly one official tUSD8 `Transfer` from the vault to the recipient for `amountUnits`. Use a trusted Aevum explorer or RPC for independent verification. [Receipt field map](../skills/agentpay/SKILL.md#receipt-field-map)

## Boundaries and evidence

Agent credentials stay scoped to an active agent and vault even when an owner has multiple agents. The adapter provides no funding, withdrawal, policy-update or owner-control tools. Tool annotations describe side effects; API and contract checks enforce actual financial authority.

AgentPay submits the mandate, service, purpose, and evidence in public GenLayer transaction arguments. Aevum contract data also remains public. Omit personal names, home addresses, children's routes, credentials, and unredacted invoice details. Label owner-authorized nominal tests and describe only the test being run.

API requests time out after 15 seconds, responses are limited to 1.5MB, and local calls are capped at 60 per minute. The cross-chain executor is trusted within Aevum's hard limits. Studio development state can reset, and an on-chain transfer does not establish merchant identity or fulfillment.
