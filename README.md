# AgentPay

Payment infrastructure for AI agents: give an agent a financial mandate, enforce its limits on QDay Aevum, and inspect why every payment was allowed or denied.

An owner funds an Aevum tUSD8 vault. The agent requests services through a scoped API credential. Deterministic checks validate its authority and budgets; GenLayer adjudicates the service purpose and supporting evidence. A trusted, restricted executor submits only finalized approvals. The vault independently enforces payment caps, weekly/lifetime budgets, recipients, expiry, revocation and replay protection. The owner can withdraw unused funds, including while paused.

## Run the dapp

Requirements: Node 22.22 or newer, npm, a MongoDB Atlas free-tier connection, and the deployed Aevum and GenLayer contracts. Copy `.env.example` to `.env.local` and configure the values privately using the live-infrastructure instructions below. Signing keys belong on the execution worker; the frontend needs only public network configuration and server-side Atlas credentials.

```bash
npm ci
npm run dev
```

Open http://localhost:3000 for the animated landing page, http://localhost:3000/workspace to connect your owner wallet, and http://localhost:3000/docs for the complete guide. Setup follows four steps: name the agent, define its mandate and limits, configure approved recipients and the vault, then review and deploy. Fund the vault with tUSD8 and generate an agent API credential from owner controls. No demo data is presented by the default dapp.

```bash
npm run build
npm start
```

## Connect an autonomous agent

The [agent API reference](docs/api.md) describes authenticated treasury, mandate, payment submission, status and history endpoints. The full web guide is available at `/docs`. A payment request is asynchronous; a successful request response does not mean funds have settled.

Install [the AgentPay skill](skills/agentpay/SKILL.md) in your agent host, or use the included MCP adapter:

```bash
npm run mcp
```

Configure `AGENTPAY_BASE_URL` and `AGENTPAY_API_KEY` privately in the agent host environment. The MCP server exposes five tools scoped to the credential's agent treasury. See [MCP setup](mcp/README.md) for configuration and its spending-tool trust boundary.

## Verify

```bash
npm run typecheck
npm run test:coverage
npm run test:contracts
node tools/contracts.mjs coverage
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run check:genlayer
npx playwright install --with-deps chromium
npm run test:e2e
npm run check:secrets
npm audit --audit-level=high
npm run verify:network
```

Coverage gates require at least 80% statements, branches, functions and lines for the core/backend. Solidity tests include fuzzed payment amounts, authority controls, budget boundaries, non-reset policy updates, replay, expiry and reentrancy. GenLayer tests use an SDK test double for state/consensus-boundary regression checks; they are not evidence of live validator consensus. The network command performs real read-only Aevum/token checks and does not claim an AgentPay deployment.

## Connect live infrastructure

Use `bash tools/setup-live.sh` for hidden-input configuration, or copy `.env.example` to `.env.local` and configure it privately. Never paste signing keys into chat or commit them.

1. Configure MongoDB Atlas free-tier persistence and a database-scoped user. Network access must permit the hosting environments; review the exposure of any broad network allowlist. Demo and live use separate state namespaces.
2. Create dedicated testnet wallets with `npm run wallets:create`. The command prints public funding addresses and saves keys only in an ignored mode-0600 file. Fund the Aevum deployer/executor with tQDAY and the governance operator only if the selected GenLayer environment requires it; Studio-dev is the requested hosted gasless development target. The owner wallet also needs tQDAY and tUSD8 from the official faucet.
3. Configure the public owner/executor addresses and private local deployment/operator keys. Run `npm run build:contracts`, `npm run deploy:genlayer`, and `npm run deploy:contracts` only when ready to submit real testnet transactions. Successful scripts write public deployment evidence under `docs/deployments/`.
4. Set `AGENTPAY_MODE=live`, Atlas settings, the public executor address, and the deployed governance contract address. Connect the owner wallet. Create/configure a vault through the interface or register the deployed vault; fund it and issue an agent credential.
5. Configure the protected `agentpay-testnet` GitHub Actions environment. Secrets: `MONGODB_URI`, `AEVUM_EXECUTOR_PRIVATE_KEY`, `GENLAYER_OPERATOR_PRIVATE_KEY`. Variables: `AGENTPAY_DATABASE`, `AEVUM_EXECUTOR_ADDRESS`, `GENLAYER_CONTRACT_ADDRESS`. The worker signs on hosted runners, not in a Vercel request.
6. Deploy the frontend/API to Vercel using [VERCEL.md](VERCEL.md). Vercel receives public chain/contract configuration and Atlas credentials, but not execution signing keys. Configure `APP_ORIGIN` to the exact HTTPS origin.
7. Add a curated `AGENTPAY_SERVICES_JSON` list if using the live service catalog. Addresses must satisfy the owner’s on-chain allowlist; the product does not imply merchant verification from catalog inclusion.

GitHub Actions provides five-minute scheduled recovery and manual workflow dispatch. Its scheduling is not guaranteed, and GenLayer finality adds latency. This prototype is asynchronous and has no immediate-payment SLA. No dedicated server, account-abstraction provider, bundler, paymaster or bridge is required.

## Network and technologies

QDay Aevum Testnet: chain `44005`, RPC `https://rpc-test.qday.info`, explorer `https://explorer-test.qday.info`, native gas `tQDAY`, tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483` with **6 decimals**, Shanghai EVM. Solidity 0.8.24 and OpenZeppelin provide the vault; Next.js/React/TypeScript/viem provide the app; GenLayerJS and a pinned GenVM runner provide mandate governance; MongoDB Atlas stores the durable request ledger; GitHub Actions runs the executor; Vercel hosts the app.

The implemented QDay interface is verified Ethereum JSON-RPC. No separate “QDay API v6” specification was available, so no v6-specific capability is claimed.

## Documentation and boundaries

- [Architecture and trust](docs/architecture.md)
- [Agent API](docs/api.md)
- [Submission checklist and judging map](docs/submission.md)
- [Roadmap](docs/roadmap.md)
- [Dependency notices](NOTICE.md)

GenLayer decides purpose; Aevum controls funds. Cross-chain semantic approval depends on the trusted executor, which can spend within the vault’s hard limits if compromised. The contract does not cryptographically prove GenLayer finality. Policy evidence is untrusted input, not proof of merchant legitimacy or delivery. The single-agent prototype caps stored request history and uses an aggregate CAS document; mainnet use requires further security, operational, key-management, and scale work.

Market demand and willingness to pay remain hypotheses. The target users are agent developers and teams buying research/data/API services; validate this demand before claiming traction.

## Team

Solo builder: [TS-mfon](https://github.com/TS-mfon). Hackathon registration must be confirmed in the submission portal.

## Primary references

[QDay documentation](https://community.qday.io/guide/), [official QDay repositories](https://github.com/qday-io), [event guide](https://drive.google.com/file/d/1QvkDX_lgbnKh4wZHc-gWMpWsn8YdHCOu/view), [GenLayer documentation](https://docs.genlayer.com/), [GenLayerJS](https://github.com/genlayerlabs/genlayer-js), and [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/).

AgentPay code is MIT licensed. Installed dependencies retain their licenses. See LICENSE and NOTICE.md.
