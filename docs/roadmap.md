# Roadmap

## Implemented testnet surface

AgentPay now separates owner work into `/agents` cards, `/agent/:id` details with per-agent vault and owner controls, `/setup` creation, `/console` payment requests, `/history` records, and `/docs` integration guidance. An owner may register several distinct agents, each with a separate funded Aevum vault. Agent credentials and API operations remain scoped to one agent and treasury.

The implemented protocol includes natural-language GenLayer adjudication, immutable policy versions, Aevum tUSD8 settlement and deterministic limits, scoped credentials, idempotent request admission, durable asynchronous processing, owner funding/withdrawal/revocation, and inspectable request/decision/transaction references. Pending commitments are distinguished from available funds. The published skill and five-tool MCP interface cover safe purchasing, recovery, structured responses, receipt-field mapping and evidence disclosure.

These implementation claims do not establish a successful live payment. Record actual finalized GenLayer decisions, successful Aevum events, hosted-worker recovery, and usable public deployment evidence separately during validation.

## Before submission

- Verify end-to-end live approval and rejection, including prompt injection, conflicting evidence, duplicate admission and retry/recovery behavior.
- Confirm children-transport and water-bill tests reach inspectable terminal outcomes; do not label a pending test as paid or claim an actual bill was settled.
- Verify each owner page on phone/desktop and prove credentials for one agent cannot inspect or spend another vault.
- Capture a reproducible live demo and accessible video with real chain/decision references.
- Confirm public repository and deployed app are accessible without login requirements unrelated to wallet authorization.
- Finish the project submission, solo-builder registration, and judging evidence before the deadline.

## Next product work

- Validate demand through interviews and paid-service experiments rather than claiming willingness to pay without evidence.
- Add policy simulation before activation and verified merchant/evidence workflows, with a deliberate privacy model for disclosed governance inputs.
- Explore shared-vault multi-agent delegation and aggregate treasury caps. Separate owner-managed vaults are implemented; pooled multi-agent budgets are not.
- Replace bounded global aggregate persistence/history with tenant-aware capacity, archival and scalable per-request indexing.
- Add worker-health/stage observability and bounded failure isolation while preserving necessary governance-write serialization.
- Improve operational key custody, runtime monitoring and independent cross-chain authorization verification.
- Complete independent financial-security review, durable governance infrastructure and operational readiness before mainnet.

The Aevum owner smart-account pilot uses a prefunded account. Gas sponsorship, bridges, streaming payments, and broad marketplace protocols remain future work.
