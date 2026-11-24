# AgentPay API and MCP contract

## Authentication and response rules

Agents use an owner-issued `ap_` bearer credential bound to one active agent and vault. Only its digest is stored. Rotation invalidates the predecessor; revocation removes spending authority. The credential cannot administer an owner wallet, select another vault, fund, withdraw, or edit policy.

All REST responses use `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`. Amounts are decimal strings with up to six fractional places. Use exact integer/decimal arithmetic, never floating point. Successful payment submission currently returns HTTP 200 with a stored asynchronous request; it does not mean settlement.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/v1/treasury` | Credential-scoped treasury, balance, available funds and authority |
| GET | `/api/v1/policy` | Current mandate, hash/version, limits, recipients and expiry |
| POST | `/api/v1/payments` | Validated asynchronous request |
| GET | `/api/v1/payments` | Bounded newest-first request, decision and settlement history |
| GET | `/api/v1/payments/:id` | One credential-scoped request and its receipt references |

The API derives the vault and owner from the credential. Adding an owner or treasury query parameter does not widen access; unsupported purchase-body fields are rejected. A request ID is a 32-byte hexadecimal AgentPay reference, not a GenLayer or Aevum transaction hash.

## Funds and authority

`balance` is the raw on-chain token balance. `reservedBalance` is committed to eligible pending requests, including unresolved submitted Aevum transactions. `availableBalance` is raw balance minus commitments, clamped to zero. These are tUSD8 decimal strings, not deposits or budget allocations.

`availableWeeklyBudget` and `availableTotalBudget` account for settled spending and pending commitments. `spendableBalance` is the minimum of the available balance and remaining weekly/lifetime authority. `perPaymentLimit` remains an independent purchase cap. Existing requests or owner controls can change these figures after a read; admission and settlement independently recheck the actual restrictions.

Older deployments may lack additive availability fields. The MCP leaves them absent rather than inferring that the entire raw balance is spendable. Policy `validUntil` uses Unix seconds. Payment `createdAt` and `expiresAt` use ISO UTC; MCP adds `authorizationExpiresAt` as an ISO rendering of validUntil.

## Purchase input

Send `Authorization: Bearer <private environment credential>` and `Content-Type: application/json`. The body is bounded to 16KB and accepts only these fields:

| Field | Validation |
| --- | --- |
| `recipient` | Actual approved EVM address; confirm which address represents the intended payee |
| `amount` | Positive decimal string with at most six places |
| `service` | 1-120 trimmed characters |
| `purpose` | 3-1000 trimmed characters |
| `evidence` | Optional bounded plain text, up to 4000 characters; defaults to empty |
| `idempotencyKey` | 8-100 letters, numbers, `_`, or `-`, persisted with the exact purchase body |

Illustrative request shape, not a live bill or authorized recipient:

```json
{
  "recipient": "0x2222222222222222222222222222222222222222",
  "amount": "0.001",
  "service": "Household water bill test",
  "purpose": "Owner-authorized nominal test of a household utility request",
  "evidence": "Test only; no actual invoice or delivered service is claimed",
  "idempotencyKey": "water-test-job-2026-001"
}
```

Choose the actual owner-approved address and amount before submitting. A nominal test must be expressly authorized and must not be represented as payment of an actual bill. An approved address establishes financial permission, not independent merchant identity or invoice authenticity.

Service, purpose, mandate and evidence enter GenLayer transaction arguments. Treat them as disclosed to governance infrastructure. Do not include credentials, personal names, children's routes, home addresses, bank information, or unredacted private invoice content. No arbitrary URL fetching or merchant-verification service is implied.

## Idempotency, lifecycle and recovery

The request binds treasury ID, agent ID, stable purchase key, exact normalized purchase fields, mandate hash and policy version. An identical payload/key returns the same request. A changed purchase or applicable policy under the same key produces `IDEMPOTENCY_CONFLICT`. A new key can create a second payment; it is not a retry mechanism.

Main lifecycle: `queued` → `awaiting_finality` → `approved` → `executing` → `settled`. A mandate that needs registration also passes through `evaluating`. The worker journals the signed GenLayer registration/evaluation envelope and hash before broadcast; losing the RPC response cannot erase that submitted identity. `rejected` and `needs_information` never authorize settlement. Failed and expired requests remain inspectable. Accepted GenLayer consensus is insufficient: the worker requires finalized successful consensus and matching request/mandate/version references.

GitHub Actions normally checks every five minutes, with variable scheduling and finality latency. Requests expire within one hour or at mandate expiry, whichever is earlier. REST status/history may include the additive processing metadata below. These fields describe eligibility and recovery state; they do not provide a guaranteed next run, settlement ETA or worker-health heartbeat. Older records may omit them.

| Optional field | Meaning |
| --- | --- |
| `retryAt` | Unix milliseconds when another processing attempt becomes eligible; the Actions schedule can run later |
| `lastAttemptAt` | Unix milliseconds when the worker last claimed this request |
| `consecutiveFailures` | Consecutive processing failures; ordinary pending-finality responses reset this counter |
| `leaseUntil` | Unix milliseconds until the current processing ownership lease expires; clients must not treat it as permission to submit a duplicate |
| `governanceUnresolved` | A signed or known GenLayer write still needs finality reconciliation; may remain true after financial expiry or a failed request |

Escalate persistent lack of progress using the request ID, status, attempts, expiry, retry metadata and error. `attempts` counts claimed state-processing operations, not only failed RPC retries.

The MCP adapter returns its advertised output schema. Hosts must not assume that every additive REST metadata field is also present in MCP results.

Signed GenLayer and Aevum bytes and their transaction hashes are saved before broadcast. Recovery reconciles the existing transaction and rebroadcasts only identical bytes when appropriate. GenLayer signing recovery currently uses Studio envelope references on governance chain `61997`; a saved registration must finalize successfully before evaluation continues. Credentials, raw execution/evaluation bytes, and raw registration journals are never returned to API clients. An unresolved submitted Aevum transaction may still settle after local expiry; its funds remain committed until reconciliation resolves it.

The worker sweeps eligible expired unexecuted requests without RPC. It selects due independent work while preserving two write gates: an unresolved shared-governance write blocks newer governance submissions, and an uncertain executing transfer blocks another settlement preparation with the same signer. Failed or expired unresolved governance records are polled read-only until finality is known; they are never revived as payment approvals.

Transient failures use a 15-second-to-five-minute exponential backoff with request-stable jitter. Six consecutive failures exhaust automatic retries for unbroadcast work. Ordinary pending-finality polls do not consume that budget, and an uncertain `executing` transaction is not marked failed merely because an RPC timeout or retry limit occurred. Preserve its original reference and wait for reconciliation or operator diagnosis.

Poll every 15-30 seconds with backoff. A timeout can occur after acceptance. Retrieve the original request or inspect history before retrying; if its ID is lost, retry only the exact saved payload/key. REST history has no cursor or key-search endpoint. MCP's 1-100 limit is a local slice of the bounded history.

## Error recovery

| HTTP / code | Action |
| --- | --- |
| 400 / `INVALID_REQUEST` | Correct required fields, positive string amount, precision and key format |
| 400 / `PAYMENT_LIMIT` | Read per-payment authority; do not split a purchase to evade it |
| 400 / `INSUFFICIENT_BALANCE` | Check pending reservations and available funds; owner funding or completed requests may be needed |
| 400 / `WEEKLY_BUDGET`, `TOTAL_BUDGET` | Read remaining authority; owner review is required to expand it |
| 401 / `UNAUTHORIZED` | Obtain a current scoped credential; never reuse a revoked key |
| 403 / `RECIPIENT_NOT_ALLOWED` | Read policy recipients and confirm the intended payee with the owner |
| 409 / `IDEMPOTENCY_CONFLICT` | Reconcile the original payload/key and request; do not guess with a new key |
| 409 / `TREASURY_SELECTION_REQUIRED` | Owner APIs require the selected owned vault when several exist |
| 429 | Back off with jitter and reduce calls |
| 503 | Preserve request identity and retry reads; availability failure does not establish failed settlement |

## Receipt mapping

History/status includes purchase fields, `treasuryId`, `agentId`, policy version, mandate hash, request hash, `amountUnits`, timestamps, state, attempts, decision/explanation and any transaction hash. Credentials and raw signed transaction bytes are excluded.

| Payment record | Verification |
| --- | --- |
| `transactionHash` | Aevum transaction reference; a `settled` record requires a successful matching receipt on chain 44005 |
| `treasuryId` | Contract emitting the `PaymentExecuted` event and source vault |
| `id` | Event `requestId` |
| `agentId`, `policyVersion` | Matching event fields |
| `recipient` | Vault-event recipient and official tUSD8 `Transfer.to` |
| `amountUnits` | Exact vault-event amount and official tUSD8 `Transfer.value`; tUSD8 has six decimals |
| `requestHash`, `decisionRef` | Matching event request hash and GenLayer evaluation reference |
| `mandateHash`, `policyVersion`, `requestHash` | Matching finalized GenLayer decision and historical policy |

Use `https://explorer-test.qday.info/tx/<transactionHash>` or trusted Aevum JSON-RPC at `https://rpc-test.qday.info`. tUSD8 is `0x456569838f1d43009A91ebA4263147Afd7233483`. Before marking `settled`, the backend requires one matching `PaymentExecuted` event from the expected vault and exactly one `Transfer` emitted by that official token from the vault to the recorded recipient for `amountUnits`. MCP returns the record and references; it does not independently fetch or cryptographically verify the Aevum receipt. State when verification is backend-reported. A transfer receipt does not prove merchant identity, service quality or delivery.

The adapter's internal `verification_failed` result is represented publicly as `status: "failed"`, preserving `transactionHash` and an error requesting receipt review. It means a mined successful transaction lacked matching payment proof, not that it reverted or that no tokens moved. This known mined request is not automatically rebroadcast or re-signed. Verify its receipt and actual token transfers with the owner/operator before submitting another purchase with a new key. RPC uncertainty remains `executing` and continues reconciliation; a confirmed revert has its separate error explanation.

## Owner pages and APIs

Owners connect/sign a wallet challenge and browse `/agents`. `/setup` creates another distinct vault-backed agent. `/agent/:id` uses the owned vault ID and contains that agent's mandate, vault and controls. `/console?treasuryId=:id` submits payment requests; `/history?treasuryId=:id` inspects history; `/docs` teaches integration. `/agent`, `/sgents` and `/workspace` redirect to the agents list.

Owner wallet sign-in uses `/api/auth/nonce`, `/api/auth/verify` and `/api/auth/logout`. Sessions use HttpOnly SameSite cookies. Mutating owner requests require the exact configured origin. Each selected owner route checks ownership; agents cannot use an API key as an owner session.

| Method | Owner path | Scope |
| --- | --- | --- |
| GET | `/api/owner/agents` | Real agents owned by the authenticated wallet |
| GET | `/api/owner/dashboard?treasuryId=:id` | Selected owned vault, mandate and history |
| POST | `/api/owner/setup` | Create/register a new distinct owned vault-backed agent |
| POST | `/api/owner/payments?treasuryId=:id` | Request a payment for the selected agent |
| POST | `/api/owner/policy?treasuryId=:id` | Register a confirmed new mandate version |
| POST | `/api/owner/controls?treasuryId=:id` | Synchronize confirmed funding, withdrawal, pause or revocation |
| POST | `/api/owner/credentials?treasuryId=:id` | Rotate a credential for the selected agent only |

The agents-list response contains `agents` and `unavailable` collections. A vault that cannot be refreshed is returned as unavailable with its identity and a safe error, not a fabricated balance. Other healthy agents remain visible.

Omitting selection is compatible for zero/one vault; when several exist, select explicitly. A duplicate vault registration remains prohibited. The current custody model assigns a separate vault to each registered agent, rather than sharing one aggregate budget among multiple agents.

## MCP

Run the repository's `mcp/server.ts` through the installed tsx binary with private `AGENTPAY_BASE_URL` and `AGENTPAY_API_KEY`. The official SDK is `@modelcontextprotocol/server` 2.4.0. The maintained skill is [skills/agentpay/SKILL.md](../skills/agentpay/SKILL.md), also downloadable at `/docs/skill`.

Tools remain `agentpay_treasury`, `agentpay_policy`, `agentpay_request_payment`, `agentpay_payment_status` and `agentpay_payment_history`. Every tool advertises an output schema. Successful calls provide `{success: true, data}` in both `structuredContent` and JSON text. Handler/API errors set `isError: true` and return a safe structured error envelope, with actual `httpStatus` when available; SDK argument-validation errors can be plain text. Inspect `isError` first, then parse only JSON content as JSON.

Only the request tool can cause payment. A standing owner mandate may authorize purchases, subject to narrower host controls. Annotations describe side effects, while the API and vault enforce permissions. The adapter validates a fixed origin, refuses redirects, times out in 15 seconds, caps responses at 1.5MB and local calls at 60/minute, and never forwards upstream secrets in errors.

Verified SDK references: [tools and structured results](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/servers/tools.md), [stdio serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/serving/stdio.md).

MCP distinguishes `REQUEST_TIMEOUT` (the 15-second request deadline) from other `NETWORK_UNAVAILABLE` connection failures. Either can happen after acceptance and requires reconciliation of the original request identity.
