# Submission acceptance checklist

Deadline: 11 December 2026, 08:00 UTC (09:00 Lagos). Submit early.

- [ ] Public repository opens in a logged-out browser.
- [ ] Secret scan passes, including Git history; no private keys, actual .env files or API credentials published.
- [ ] A stranger can follow the README and run the interface.
- [ ] AgentPay vault and successful payment are deployed on official Aevum Testnet 44005 with test tokens.
- [ ] GenLayer decision transaction is finalized and matches the payment request/mandate version.
- [ ] Live URL works without deployment protection blocking judges.
- [ ] Demo video URL works without login and distinguishes live evidence from simulation.
- [ ] All team members are listed and registered; owner must provide the public roster and confirm registration.
- [ ] Submit before deadline; top-five teams are ready for a 3-5 minute live presentation.

## Judging map

| Criterion | Weight | AgentPay demonstration/evidence |
|---|---:|---|
| User experience and presentation | 15 | Accessible mandate, budget, request and receipt interface on desktop/mobile; clear loading/error states |
| Reliable structured demo | 10 | Relevant service paid, unrelated purpose denied at same allowed amount, retry/recovery and withdrawal shown |
| Documentation | 10 | README, architecture/trust diagram, API reference, platform configuration, limitations and roadmap |
| Innovation and originality | 20 | Programmable financial mandate evaluated semantically with independent hard spending limits |
| Technical/platform integration | 15 | Aevum vault budgets, expiry, scoped credentials, finalized GenLayer decision, durable async execution, idempotency |
| Utility and market potential | 15 | Agent/API research-services workflow; audience and distribution hypotheses with a plan to validate willingness to pay |
| Safety/trust/controls | 15 | Least authority, separate signing keys, contract caps, evidence injection controls, owner revocation/withdrawal, verifiable receipts |

## Pitch and demonstration

Explain the problem: an agent needs services, but its owner should not grant unrestricted wallet access. Show a 40 tUSD8 weekly mandate with a 10 tUSD8 payment cap and approved recipients. Run a relevant research API request, inspect the finalized policy explanation, then verify Aevum settlement and its receipt. Submit an unrelated-purpose request at an otherwise valid amount to demonstrate semantic judgment. Show duplicate protection, pause/revocation and withdrawal of unused funds. State the bounded executor trust assumption.

Audience hypotheses: developers running research agents and teams buying data/API services. Initial distribution hypothesis: a simple agent API integration and service-provider examples. Willingness to pay has not been validated; interview target users and test demand before making claims. Mainnet requires additional operational controls and independent review.
