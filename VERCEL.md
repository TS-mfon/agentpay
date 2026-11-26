# Vercel deployment

Use the Next.js preset, the repository root, `npm run build`, and Node 22. Build the vault artifact before publishing if owner wallet deployment is required; its checked-in ABI/bytecode is generated from this repository's Solidity source.

Set AGENTPAY_MODE=live, APP_ORIGIN to the exact HTTPS site origin, MONGODB_URI, AGENTPAY_DATABASE=agentpay, AEVUM_EXECUTOR_ADDRESS, GENLAYER_NETWORK=studio-dev and GENLAYER_CONTRACT_ADDRESS. Vercel does not need treasury execution private keys. Put those only in the protected GitHub Actions executor environment.

Set `AGENTPAY_SMART_ACCOUNTS=true` in an Aevum testnet preview for a funded smoke test. Activate a fresh account, create and fund a vault, pause and resume it, and settle one GenLayer-approved tUSD8 payment before turning on the hosted option. Record the activation, resume, and payout receipts from the Aevum explorer.

Local demo storage uses a file. A hosted demo must use Atlas with AGENTPAY_MODE=demo and a separate database such as agentpay_demo. Never point simulated execution at the live database.

GitHub Actions runs the executor every five minutes plus manual workflow dispatch. Scheduling can be delayed or skipped and has no latency SLA. The API returns asynchronous status; it does not keep a Vercel request alive while consensus or settlement completes. Public Linux hosted-runner usage and Vercel Hobby eligibility must fit current provider terms and usage limits. Track runtime before increasing frequency. Do not use this prototype as an unattended mainnet treasury.

Publish only after local verification. Deployment needs a configured Atlas database, registered GenLayer governance contract, deployed Aevum vault, and funded dedicated testnet executor. The repository records deployment artifacts only after actual transactions; no simulated address is deployment evidence.
