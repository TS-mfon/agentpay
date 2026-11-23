# AgentPay Aevum vault

The vault holds a single ERC-20 token and restricts the executor to owner-configured financial permissions. It does not verify GenLayer consensus cryptographically; the configured executor is trusted to submit only finalized approvals. The vault independently enforces limits, recipient restrictions, policy versions, expiry, pause, revocation and replay protection.

Tests use a local token and fixed Unix week boundaries. tUSD8 uses six decimal places; tQDAY pays transaction gas on Aevum. Compilation targets Solidity 0.8.24 and Shanghai.

Run `npm run test:contracts` and `npm run build:contracts` from the project root. The build exports ABI and deployable bytecode to `contracts/artifacts/AgentTreasury.json`.

Pause invalidates all previously configured agent authority through a monotonically increasing authorization epoch. Unpausing alone does not revive pending approvals: the owner must publish a strictly higher policy version and configure that agent again. Policy changes preserve lifetime and current-week settled spending. Ownership transfer is two-step and ownership renunciation is disabled to avoid stranding funds.
