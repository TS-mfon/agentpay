# Agent API

Agents use a random `ap_` bearer credential scoped to one active treasury and agent. Only its digest is stored. Issuing another key invalidates the previous key; revocation stops the credential. Never put the credential in a URL or repository.

All responses are `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`. Amounts are decimal strings with up to six places. Do not use floating point for money.

| Method | Path | Result |
|---|---|---|
| GET | `/api/v1/treasury` | Authorized treasury and current balance/authority |
| GET | `/api/v1/policy` | Mandate text, limits, expiry, recipients and policy version |
| POST | `/api/v1/payments` | Validated asynchronous payment request |
| GET | `/api/v1/payments` | Request, decision and settlement history |
| GET | `/api/v1/payments/:id` | Status and receipt information for the agent’s request |

Example payment body:

```json
{
  "recipient": "0x2222222222222222222222222222222222222222",
  "amount": "4",
  "service": "Research API",
  "purpose": "Buy a dataset for the authorized market research task",
  "evidence": "Invoice specifies the relevant market research dataset",
  "idempotencyKey": "research-job-2026-001"
}
```

The address is sample data; live recipients must be authorized by the owner. Submit with an Authorization Bearer header and application/json. Retrying the identical request with the same idempotency key returns the same request; changing its contents produces an idempotency conflict.

Lifecycle: queued → awaiting_finality → approved → executing → settled. Rejected and needs_information do not execute. Failed and expired requests are inspectable. A GenLayer transaction reaching accepted state is insufficient; the worker requires finalized successful consensus plus matching request/mandate/version references. Execution retries reconcile the signed transaction first.

History includes purpose/evidence, applicable policy version and mandate hash, decision reference/explanation, recipient/amount, status, creation/expiry and any transaction hash. Settlement links point to Aevum. Signed raw transactions and credentials are excluded from public responses.

Owner wallet sign-in uses `/api/auth/nonce`, `/api/auth/verify` and `/api/auth/logout`. The nonce is single-use, expiring, and bound to the declared origin/wallet. Sessions use HttpOnly SameSite cookies. Mutating owner requests require the exact configured origin. Owner routes cover dashboard, setup, immutable policy updates, funding/withdrawal synchronization, pause/revocation and credential rotation. Live execution runs on GitHub Actions; agent requests do not directly launch a worker.

The prototype uses persistent shared rate limits: a global cap and per-identity/per-route windows. Limits fail closed when storage is unavailable. Input bodies are bounded to 16KB, evidence is plain text, and unknown payment/policy fields are rejected. No arbitrary URL fetching is performed.


## Agent integrations

The live `/docs` page covers owner onboarding, authentication, request fields, async statuses, idempotent recovery, receipt verification, MCP setup, and current limitations. `/docs/skill` downloads the maintained `skills/agentpay/SKILL.md` without credentials.

The local stdio MCP server is `mcp/server.ts`. Run `npm ci --registry=https://registry.npmjs.org` in this repository, then configure `AGENTPAY_BASE_URL` and `AGENTPAY_API_KEY` privately before `npm run mcp`. It uses the official `@modelcontextprotocol/server` 2.4.0 SDK. Host configuration can point directly at the checkout's `node_modules/.bin/tsx` and `mcp/server.ts`.

Tools: `agentpay_treasury`, `agentpay_policy`, `agentpay_request_payment`, `agentpay_payment_status`, and `agentpay_payment_history`. Only the request tool can cause a payment; it is annotated as a spending operation. A standing owner mandate may authorize autonomous purchases; the agent must also follow any narrower host requirements. Owner administration is not exposed through MCP. The adapter validates a fixed HTTPS origin, allows loopback HTTP for local development, blocks redirects, uses a 15-second timeout, bounds responses to 1.5MB, and caps local calls at 60 per minute. It reuses the API payment schema. History's MCP limit of 1–100 applies locally; it is not server-side cursor pagination.

GitHub Actions checks queued work every five minutes; scheduling may be delayed, and finalized governance plus settlement may need subsequent worker runs. Requests expire within one hour or at mandate expiry, whichever is sooner. Poll every 15–30 seconds with backoff. Do not interpret `queued` or `approved` as payment completion.

Official SDK API references verified for the integration:
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md
