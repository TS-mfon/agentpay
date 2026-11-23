# Architecture and trust

```mermaid
flowchart LR
  O[Owner wallet] --> UI[Agents / setup / console / history]
  UI -->|select owned agent| API[Vercel API]
  O -->|fund/configure/withdraw| V[Separate Aevum tUSD8 vault per agent]
  A[Agent API credential] --> API
  API --> DB[Atlas request ledger]
  W[GitHub Actions executor] --> DB
  W --> G[GenLayer mandate adjudication]
  G -->|finalized verdict and explanation| W
  W -->|restricted executePayment| V
  V -->|payment event and receipt| API
```

GenLayer decides whether the purpose and supplied evidence satisfy a financial mandate. Independent validators reproduce the status and separately review explanation grounding. The decision binds a request hash, mandate hash and policy version. Invalid or nonfinal judgments cannot authorize execution.

Aevum holds the tUSD8 and enforces the executor, recipient allowlist, per-payment cap, UTC Unix-week budget, lifetime budget, policy version, expiry, active authorization epoch, pause and replay checks. It records actual settled spending. Owner withdrawal does not reset these budgets. Pausing invalidates existing agent authorizations; resuming requires a new policy version/configuration. Agents cannot withdraw or administer the treasury.

The executor is a trusted cross-chain attestor. Aevum does not verify GenLayer consensus cryptographically. A compromised executor can still spend within the vault's contract-enforced authority. This is the accepted testnet trust boundary, not trustless cross-chain governance. Private executor and governance keys are separate and remain on the hosted worker. The owner wallet signs setup and administration.

Atlas persists immutable policy records, hashed credentials, sessions, rate windows and an atomic request ledger. The prototype uses one CAS-versioned aggregate document to serialize changes; it intentionally caps request history and is not a production-scale data model. Worker and request leases coordinate bounded work. A signed transaction and its hash are saved before broadcasting. Recovery reconciles an existing transaction first and only rebroadcasts its identical signed bytes; it never creates a second payment for the same request.

Evidence is bounded plain text, not arbitrary fetched URLs. Invoice text and service descriptions are untrusted context, not verified merchant identity or proof of delivery. Request instructions cannot override the owner's mandate. Financial hard limits remain independent of AI judgment.

Local demo mode uses an isolated persistent file and clearly labeled semantic/payment simulation. Hosted demo uses an isolated Atlas database. Live mode requires its complete configuration and never falls back to simulated settlement.

Aevum configuration: chain 44005, tQDAY native gas, tUSD8 token 0x456569838f1d43009A91ebA4263147Afd7233483 with six decimals, HTTPS RPC https://rpc-test.qday.info, Shanghai EVM. No ERC-4337, 1Shot, bundler, paymaster, bridge or unspecified API version is a dependency.

GenLayer governance deploys to the official Studio development preview (Studio Next browser alias), using the SDK studioDevnet preset, canonical https://studio-dev.genlayer.com/api RPC and chain ID61997. It is hosted development infrastructure with temporary state and possible resets, not a durable production consensus guarantee. Aevum44005 is the actual payment chain. References: https://docs.genlayer.com/developers/networks and https://docs.genlayer.com/developers/intelligent-contracts/deploying/network-configuration.


## Owner and agent isolation

An owner can register several distinct agent vaults. `/agents` lists only the authenticated wallet's agents, and the detail page contains that selected vault's controls. Owner APIs accept a `treasuryId` selection and recheck ownership; ambiguous selection is rejected. Agent APIs always use the credential's bound treasury/agent identity, so a query parameter cannot switch the credential to another agent.

Balance reads distinguish raw funds from `reservedBalance`, `availableBalance`, and available financial authority. Pending commitments remain reserved while submitted transactions are unresolved, including after local request expiry. This avoids presenting committed funds as freely spendable.

## Evidence disclosure

The owner's mandate and request service, purpose and evidence are sent in GenLayer transaction arguments. Treat this content as disclosed to governance infrastructure; Aevum hashes do not make it private. Redact private invoice details, names, addresses, children's routes, bank information and credentials. The API does not independently establish a recipient's merchant identity, invoice authenticity or service delivery.

MCP advertises validated output schemas and preserves receipt references, but does not independently fetch Aevum receipts. The backend checks settlement events; hosts can use trusted Aevum explorer/RPC reads for independent verification. Neither API nor MCP publishes a guaranteed worker ETA or worker-health heartbeat.
