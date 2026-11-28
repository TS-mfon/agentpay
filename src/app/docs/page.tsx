import type { Metadata } from "next";
import CodeBlock from "../../components/docs/CodeBlock";
import styles from "./docs.module.css";

export const metadata: Metadata = { title: "AgentPay Docs — Build with governed payments", description: "Set up an agent treasury, integrate the AgentPay API and MCP server, understand spending controls, and verify Aevum receipts." };
const links = [
  ["quickstart", "Get started"], ["owner-pages", "Owner pages"], ["owner-setup", "Owner onboarding"], ["available-funds", "Owner balances"], ["evidence-privacy", "Evidence disclosure"], ["authentication", "Agent credentials"], ["payment-api", "Payment API"], ["lifecycle", "Execution lifecycle"], ["receipts", "Verify a receipt"], ["recovery", "Errors and recovery"], ["mcp", "MCP integration"], ["skill", "Agent skill"], ["controls", "Owner controls"], ["architecture", "Architecture and trust"], ["limits", "Current limitations"],
];
const apiRows = [
  ["POST", "/api/v1/payments", "Validate and queue an asynchronous tUSD8 purchase"],
  ["GET", "/api/v1/payments/:id", "Payment status and Aevum settlement references"],
  ["GET", "/api/v1/payments", "Newest-first history for the credential’s vault"],
  ["GET", "/api/v1/services/research?paymentId=:id", "Sample dataset and receipt for a settled Research API payment"],
];
const fields = [
  ["recipient", "Required", "Approved 0x EVM address (40 hexadecimal characters)"],
  ["amount", "Required", "Positive decimal string; at most 6 fractional digits and 13 integer digits"],
  ["service", "Required", "Service name, 1–120 characters"],
  ["purpose", "Required", "Why this purchase serves the mandate, 3–1000 characters"],
  ["evidence", "Optional", "Plain text, at most 4000 characters; defaults to an empty string"],
  ["idempotencyKey", "Required", "Stable purchase key, 8–100 letters, numbers, underscores, or hyphens"],
];
const statuses = [
  ["queued", "Pending", "Request is stored and awaits the executor"],
  ["evaluating", "Pending", "Policy evaluation is being submitted"],
  ["awaiting_finality", "Pending", "The evaluation is waiting for finalized consensus"],
  ["approved", "Pending", "Finalized approval passed reference checks; funds have not yet settled"],
  ["executing", "Pending", "Signed Aevum transaction is being submitted or reconciled"],
  ["settled", "Terminal", "Live payments have an Aevum receipt. Simulated payments report status"],
  ["rejected", "Terminal", "The owner can inspect the denial in wallet-authenticated history"],
  ["needs_information", "Terminal", "Ask the owner to review the explanation before revising the purchase"],
  ["expired", "Terminal", "Request, approval, or mandate authority expired or was invalidated"],
  ["failed", "Terminal", "Ask the owner to inspect the failure and reconcile any Aevum transaction"],
];
const readExample = String.raw`export AGENTPAY_BASE_URL="https://YOUR_APP_ORIGIN"
# Set AGENTPAY_API_KEY privately in your agent runtime first.
curl --silent --show-error --fail-with-body \
  "$AGENTPAY_BASE_URL/api/v1/payments" \
  --header "Authorization: Bearer $AGENTPAY_API_KEY"`;
const requestExample = `# Set APPROVED_RECIPIENT to a real address allowed by the owner.
# Save this exact payload and purchase key before the first submission.
node --input-type=module -e '
const response = await fetch(process.env.AGENTPAY_BASE_URL + "/api/v1/payments", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + process.env.AGENTPAY_API_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    recipient: process.env.APPROVED_RECIPIENT,
    amount: "4",
    service: "Research API",
    purpose: "Purchase a dataset for the authorized market research task",
    evidence: "Use the actual invoice or service evidence here",
    idempotencyKey: "research-job-2026-001"
  })
});
const result = await response.json();
if (!response.ok || !result.success) throw new Error(result.error?.message);
console.log(JSON.stringify(result.data));
'`;
const responseExample = `{
  "success": true,
  "data": {
    "id": "<32-byte request ID returned by the API>",
    "status": "queued",
    "policyVersion": 1,
    "idempotencyKey": "research-job-2026-001",
    "expiresAt": "<request expiry timestamp>"
  }
}`;
const receiptExample = `{
  "success": true,
  "data": {
    "id": "<AgentPay request ID>",
    "treasuryId": "<vault address>",
    "agentId": "<agent reference>",
    "recipient": "<approved recipient>",
    "amount": "0.001",
    "amountUnits": "1000",
    "status": "settled",
    "policyVersion": 1,
    "requestHash": "<purchase binding hash>",
    "transactionHash": "<Aevum settlement transaction hash>"
  }
}`;
const pollExample = String.raw`# Use the request id returned by POST, not a transaction hash.
curl --silent --show-error --fail-with-body \
  "$AGENTPAY_BASE_URL/api/v1/payments/$AGENTPAY_REQUEST_ID" \
  --header "Authorization: Bearer $AGENTPAY_API_KEY"
# Poll every 15–30 seconds; back off on 429 and 503.`;
const mcpConfig = `{
  "mcpServers": {
    "agentpay": {
      "command": "/ABSOLUTE/PATH/agentpay/node_modules/.bin/tsx",
      "args": ["/ABSOLUTE/PATH/agentpay/mcp/server.ts"],
      "env": {
        "AGENTPAY_BASE_URL": "https://YOUR_APP_ORIGIN",
        "AGENTPAY_API_KEY": "<owner-issued agent credential>"
      }
    }
  }
}`;
function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return <div className={styles.tableWrap} tabIndex={0}><table><thead><tr>{headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.join("|")}>{row.map((cell, i) => <td key={i}>{i === 0 || cell.startsWith("/api/") ? <code>{cell}</code> : cell}</td>)}</tr>)}</tbody></table></div>;
}
function Navigation() { return <nav aria-label="Documentation sections">{links.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>; }
export default function Docs() {
  return <div className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="AgentPay home"><img src="/icon.svg" alt="" width="34" height="34" />AgentPay</a>
      <div className={styles.headerLinks}><a href="/">Home</a><a className={styles.launch} href="/agents">My agents</a></div>
    </header>
    <div className={styles.layout}>
      <aside className={styles.sidebar}><p className={styles.navTitle}>Documentation</p><Navigation /></aside>
      <main className={styles.content} id="docs-content">
        <details className={styles.mobileNav}><summary>On this page</summary><Navigation /></details>
        <div className={styles.intro}>
          <h1>Give your agent financial authority.</h1>
          <p>Connect an agent to a funded treasury. Define what it can buy, submit a payment, and verify settlement on Aevum.</p>
          <div className={styles.introLinks}><a className={styles.launch} href="#quickstart">Start integrating</a><a href="/docs/skill" download="SKILL.md">Download agent skill</a></div>
        </div>
        <p className={styles.mobileTableHint}>Tables scroll sideways on smaller screens.</p>
        <section id="quickstart" className={styles.section}>
          <h2>Your first governed payment</h2>
          <ol>
            <li>Create a vault-backed agent in <a href="/setup">agent setup</a>, then open its card from <a href="/agents">My agents</a>.</li>
            <li>Fund the selected vault with tUSD8 and issue its agent credential in the detail page’s Owner controls.</li>
            <li>Confirm the intended recipient and approved amount with the treasury owner.</li>
            <li>Request a purchase for an approved recipient using a stable purchase key.</li>
            <li>Poll the request until settlement, rejection, or another terminal outcome. Verify the Aevum receipt before reporting paid.</li>
          </ol>
          <div className={styles.callout}><strong>Requests run asynchronously.</strong>Configured deployments ask the executor to start after a submission. GitHub can delay scheduled checks, and GenLayer finality and Aevum confirmation take additional time.</div>
          <CodeBlock code={readExample} label="Read your agent’s payment history" useOrigin />
        </section>
        <section id="owner-pages" className={styles.section}>
          <h2>One task per page</h2>
          <p>Connect your owner wallet to view your registered agents. Each agent’s detail page shows its full mandate, per-payment limit, and weekly and lifetime budgets. Full decision explanations appear in the selected agent’s payment history. <a href="/agents">My agents</a></p>
          <Table headers={["Page", "Purpose"]} rows={[
            ["/agents", "Your registered agent cards, balances and activity"],
            ["/agent/:id", "Selected agent details, mandate, vault, credential and owner controls; id is its vault address"],
            ["/setup", "Create and authorize another distinct vault-backed agent"],
            ["/console?treasuryId=:id", "Submit a payment request for the selected agent"],
            ["/history?treasuryId=:id", "Inspect the selected agent’s request and decision history"],
            ["/docs", "Owner and autonomous-agent integration guide"],
          ]} />
          <p>The owner list reports vaults that cannot be refreshed as unavailable rather than fabricating their balances. Other agents remain visible. Owner APIs validate the selected vault’s ownership. The API key always selects its own bound agent; adding a treasury or owner query parameter cannot change that authority. Compatibility paths <code>/agent</code>, <code>/sgents</code> and <code>/workspace</code> redirect to the agent list.</p>
        </section>
        <section id="owner-setup" className={styles.section}>
          <h2>Set up the owner treasury</h2>
          <p>You retain custody controls. The agent receives a scoped API identity and can request permitted purchases without holding the owner’s private key.</p>
          <ol>
            <li><strong>Connect your owner wallet.</strong> Approve any requests to add or switch to Aevum Testnet, then sign the one-time sign-in challenge. Use a wallet with tQDAY for Aevum gas.</li>
            <li><strong>Name the agent and write its mandate.</strong> Describe the authorized task, services, and evidence requirements. Numeric limits and recipient addresses remain separate hard controls.</li>
            <li><strong>Set payment, weekly, and lifetime budgets.</strong> The per-payment cap must not exceed the weekly budget, and the weekly budget must not exceed the lifetime budget. Amounts use six-decimal tUSD8 precision.</li>
            <li><strong>Approve actual recipients and choose a vault.</strong> Create a new Aevum vault or register a compatible owner-controlled vault. The token, owner, mandate, version, limits, expiry, and configured recipients must match the on-chain state.</li>
            <li><strong>Review and sign.</strong> Your wallet deploys/configures the vault; AgentPay verifies and registers it. If deployment succeeds but configuration fails, retain the vault address and resume with the existing-vault option.</li>
            <li><strong>Fund and connect the agent.</strong> Add tUSD8 on the selected agent’s detail page, then issue that agent’s credential. The <a href="https://faucet.qday.info/en" target="_blank" rel="noreferrer">official faucet</a> supplies test assets; tQDAY pays gas and tUSD8 funds purchases.</li>
          </ol>
          <p>Select <strong>Aevum Testnet</strong> in the workspace header to request a switch. If your wallet requires manual setup, add <strong>QDay Aevum Testnet</strong> with chain ID <code>44005</code>, RPC <code>https://rpc-test.qday.info</code>, currency symbol <code>tQDAY</code> with 18 decimals, and explorer <code>https://explorer-test.qday.info</code>. Select the network in your wallet, then retry.</p>
          <p>Choose <strong>Open smart account</strong> and use the same browser wallet each time. AgentPay finds the QDay account controlled by that wallet. If the account is new, send tQDAY to its Aevum address and activate it. If it already exists, sign in to see its agents. Choose <strong>Use browser wallet</strong> to return to the treasuries owned directly by your wallet.</p>
          <p>The browser wallet pays tQDAY to deploy a new vault. The smart account owns that vault and pays tQDAY for configuration and controls. Send tUSD8 to the smart-account address, then use <strong>Add funds</strong> in the agent's page to move it into the vault. Withdrawals return tUSD8 to the smart account.</p>
          <p>A useful mandate states the permitted purpose, relevant service categories, approved evidence, and exclusions. For example: “Spend on research APIs and datasets for this market research task. Reject unrelated services and invoices that do not identify the purchased research.”</p>
        </section>
        <section id="available-funds" className={styles.section}>
          <h2>Review available funds as the owner</h2>
          <p>Sign in with the owner wallet to see what the vault can spend. Withdrawals, pending requests, and finality can change availability after a read. The API and vault recheck limits.</p>
          <Table headers={["Field", "Meaning"]} rows={[
            ["balance", "Raw tUSD8 held in the vault"],
            ["reservedBalance", "Pending commitments, including unresolved submitted transactions"],
            ["availableBalance", "Raw balance minus commitments, clamped at zero"],
            ["availableWeeklyBudget", "Weekly authority left after settled spending and commitments"],
            ["availableTotalBudget", "Lifetime authority left after settled spending and commitments"],
            ["spendableBalance", "Minimum available balance, weekly budget and lifetime budget"],
          ]} />
          <p>Amounts are decimal strings. The per-payment cap applies independently. Funds for an unresolved transaction remain reserved because it can still settle after local request expiry.</p>
        </section>
        <section id="evidence-privacy" className={styles.section}>
          <h2>Choose evidence you can disclose</h2>
          <p>GenLayer transaction arguments contain the owner’s mandate and the request’s service, purpose, and evidence. Those arguments and Aevum contract data remain public.</p>
          <p>Do not include credentials, personal names, children’s names or travel routes, home addresses, bank details, or unredacted private invoices. Send only the minimum non-sensitive context needed for the mandate. If required evidence cannot be shared appropriately, obtain clarification before submitting.</p>
          <p>An authorized nominal test must be identified as a test and must not claim that an actual invoice or delivered service exists. A testnet transfer does not establish that a real household bill was paid.</p>
        </section>
        <section id="authentication" className={styles.section}>
          <h2>Authenticate your agent</h2>
          <p>Every agent endpoint requires <code>Authorization: Bearer &lt;credential&gt;</code>. An <code>ap_</code> credential binds one active agent to one treasury. Only its digest is stored; the owner sees a newly issued key once.</p>
          <p>Credentials expire after 30 days. Rotation immediately invalidates the previous key. Revocation invalidates agent access and on-chain spending authority. Store credentials privately in your agent runtime or MCP host configuration.</p>
          <p>Owner sessions use HttpOnly SameSite cookies and origin checks on mutations. Agents use their own credential to submit purchases and read payment status and settlement references.</p>
          <p>REST and MCP return <code>{'{ "success": true, "data": ... }'}</code> on success and <code>{'{ "success": false, "error": { "code": "...", "message": "..." } }'}</code> on failure. Amounts are strings. Payment <code>createdAt</code> and <code>expiresAt</code> use ISO UTC.</p>
        </section>
        <section id="payment-api" className={styles.section}>
          <h2>The payment API</h2>
          <Table headers={["Method", "Endpoint", "Returns"]} rows={apiRows} />
          <h3>Request fields</h3>
          <p>POST bodies require <code>application/json</code>, are bounded to 16KB, and reject unknown fields. The treasury fixes settlement to tUSD8; a token override is not accepted.</p>
          <Table headers={["Field", "Presence", "Validation"]} rows={fields} />
          <CodeBlock code={requestExample} label="Request an authorized purchase" />
          <p>The snippet requires your real allowed recipient, purchase purpose, and supporting evidence. Its <code>4</code> tUSD8 amount and key illustrate the request shape; adapt them to the authorized purchase before submitting.</p>
          <CodeBlock code={responseExample} label="Response shape (selected fields)" />
          <p>The agent record includes request, vault and agent IDs, recipient, amount in decimal and base units, idempotency key, policy version, timestamps, status, and attempt count. Processing metadata and an Aevum transaction reference appear when available. A settled Aevum transaction also returns the purchase binding <code>requestHash</code>.</p>
        </section>
        <section id="lifecycle" className={styles.section}>
          <h2>Follow execution to completion</h2>
          <div className={styles.flow} aria-label="Main payment lifecycle"><b>Request</b><span>→</span><b>Policy checks</b><span>→</span><b>Finalized approval</b><span>→</span><b>Aevum settlement</b><span>→</span><b>Receipt</b></div>
          <p>Deterministic validation runs before GenLayer. The policy evaluator then judges purpose and evidence against the request’s mandate version. Only finalized, successful, matching approvals reach the executor. The Aevum contract independently rechecks spending authority.</p>
          <Table headers={["Status", "State", "Meaning"]} rows={statuses} />
          <CodeBlock code={pollExample} label="Retrieve payment status" />
          <p>GitHub Actions checks the queue on a five-minute schedule that can run late. Finalized approval and Aevum settlement may require multiple runs. Requests expire within one hour or at policy expiry, whichever is sooner. If a request stalls, share its ID, status, attempt count, expiry, and any retry metadata with the owner or operator.</p>
        </section>
        <section id="receipts" className={styles.section}>
          <h2>Verify what was paid</h2>
          <p>The following is an illustrative settled response shape, not a live transaction or proof of a paid bill.</p>
          <CodeBlock code={receiptExample} label="Settled record shape (illustrative fields)" />
          <Table headers={["Record field", "Compare with"]} rows={[
            ["transactionHash", "Successful Aevum transaction receipt on chain 44005"],
            ["treasuryId", "Vault emitting PaymentExecuted and token-transfer source"],
            ["id", "PaymentExecuted requestId"],
            ["agentId / policyVersion", "Matching payment event fields"],
            ["recipient", "Payment event recipient and token-transfer destination"],
            ["amountUnits", "Integer amount in the event and tUSD8 transfer"],
            ["requestHash", "Matching purchase binding in the vault event"],
          ]} />
          <p>MCP returns the record and references, and the backend verifies events before marking settlement. The MCP adapter does not independently query Aevum receipts. Use trusted explorer/RPC reads for independent verification and state when only backend-reported verification is available.</p>
          <p>For a settled request, retrieve <code>transactionHash</code> and open it on the <a href="https://explorer-test.qday.info/" target="_blank" rel="noreferrer">official Aevum explorer</a>. Confirm the receipt succeeded and the vault’s <code>PaymentExecuted</code> event matches the request ID, agent, recipient, amount, and policy version. Inspect the token transfer as supporting settlement evidence.</p>
          <p>Use hashes from <code>executing</code> and <code>failed</code> records for reconciliation. Simulated payments can reach <code>settled</code> and omit the on-chain receipt.</p>
          <div className={styles.callout}><strong>A receipt proves a transfer.</strong>Invoice text is untrusted context. A transfer receipt does not independently prove merchant identity, service quality, or delivery.</div>
        </section>
        <section id="recovery" className={styles.section}>
          <h2>Handle retries and failures</h2>
          <p>Persist the original purchase body and idempotency key before sending. Retrying identical content under the same key returns its existing request. Changing the content, including its applicable policy reference, produces <code>IDEMPOTENCY_CONFLICT</code>.</p>
          <p>A network timeout can happen after a request was saved. Retrieve its status or inspect history before retrying. MCP history offers up to 100 recent records but no cursor or key-search endpoint. If the ID cannot be recovered, resend only the exact persisted payload and key; never guess with a new purchase key. Using a new key creates a different purchase and can duplicate a payment. The executor persists signed transaction bytes before broadcast, reconciles an existing hash, and retries those same bytes.</p>
          <Table headers={["HTTP / code", "What to do"]} rows={[
            ["403 / RECIPIENT_NOT_ALLOWED", "Confirm the approved payee with the owner"],
            ["400 / INSUFFICIENT_BALANCE", "Ask the owner to review available funds and pending commitments"],
            ["400 / PAYMENT_LIMIT", "Ask the owner to review the purchase amount"],
            ["400 / WEEKLY_BUDGET or TOTAL_BUDGET", "Ask the owner to review the budget"],
            ["400 / INVALID_REQUEST", "Correct fields and decimal precision; inspect the existing request before changing a purchase"],
            ["401 / UNAUTHORIZED", "Ask the owner for a current credential; check expiry, rotation, or revocation"],
            ["409 / IDEMPOTENCY_CONFLICT", "Retrieve the original request; preserve the original payload and key"],
            ["429 / RATE_LIMITED", "Back off with jitter; reduce polling and concurrent requests"],
            ["503 / SERVICE_UNAVAILABLE", "Wait and retry status reads; do not infer failed settlement from API availability"],
          ]} />
          <p>Budget, balance, recipient, expiry, and suspended-authority checks apply independently of the AI decision. Ask the owner to review full decision explanations in their payment history. If the request needs more information, obtain the required evidence and submit a revised purchase with a new key.</p>
          <p>Updating a mandate invalidates unexecuted pending requests. Pausing or revoking invalidates pending authorization; a transaction already submitted may still settle. A network or development-state reset can require operator recovery rather than another agent request.</p>
        </section>
        <section id="mcp" className={styles.section}>
          <h2>Connect through MCP</h2>
          <p>The AgentPay 0.3.0 stdio server wraps the agent API and runs locally in the agent host. Configure it with the agent credential.</p>
          <CodeBlock code={`# Run in your AgentPay checkout (Node.js 22+).
npm ci --registry=https://registry.npmjs.org
# Configure AGENTPAY_BASE_URL and AGENTPAY_API_KEY privately.
npm run mcp`} label="Install and run the MCP server" />
          <CodeBlock code={mcpConfig} label="Private MCP host configuration" useOrigin />
          <p>Replace absolute paths with your checkout location and supply the owner-issued credential through your host’s private configuration. The base URL must be an HTTPS origin without paths, credentials, or query parameters. Loopback HTTP is allowed for local development.</p>
          <Table headers={["Tool", "Behavior"]} rows={[
            ["agentpay_request_payment", "Submit a purchase that may spend funds after approval"],
            ["agentpay_payment_status", "Read status and settlement by the 32-byte request ID"],
            ["agentpay_payment_history", "Read up to 100 recent requests with a local result limit"],
          ]} />
          <p>Every tool advertises an <code>outputSchema</code>. Successful results expose the same <code>{'{success: true, data: ...}'}</code> in <code>structuredContent</code> and JSON text. Handler/API errors set <code>isError: true</code> with a safe structured error envelope and actual <code>httpStatus</code> when available. <code>REQUEST_TIMEOUT</code> identifies the 15-second deadline; other connection failures use <code>NETWORK_UNAVAILABLE</code>. SDK argument-validation failures can be plain text. Inspect <code>isError</code> first, and parse only content that is actually JSON.</p>
          <p>The payment tool is explicitly annotated as a spending operation. Follow the agent host’s approval policy and the owner’s standing mandate. Tool annotations are descriptive hints, not security enforcement; API authentication and vault checks enforce the actual boundary.</p>
          <p>The adapter blocks redirects, applies a 15-second timeout, caps response size and local calls, and uses the API’s input schema. Tool responses return the same payment fields described above.</p>
        </section>
        <section id="skill" className={styles.section}>
          <h2>Install the AgentPay skill</h2>
          <p><a href="/docs/skill" download="SKILL.md">Download SKILL.md</a> and place it in your agent host’s skill directory, for example <code>~/.codex/skills/agentpay/SKILL.md</code>. The repository also includes it at <code>skills/agentpay/SKILL.md</code>.</p>
          <p>The skill covers authorized purchasing, idempotent retries, status recovery, and receipt verification through the API and MCP.</p>
        </section>
        <section id="controls" className={styles.section}>
          <h2>Keep control as the owner</h2>
          <ul>
            <li><strong>Fund.</strong> Deposit tUSD8 into the vault. Native tQDAY remains the gas asset.</li>
            <li><strong>Withdraw.</strong> Withdraw unused vault funds to the owner wallet, including while paused. Withdrawals do not reset spent budgets.</li>
            <li><strong>Pause.</strong> Stop new execution and invalidate outstanding authorization. Resuming configures a fresh policy version.</li>
            <li><strong>Revoke.</strong> Remove the agent’s spending authority and invalidate its credentials.</li>
            <li><strong>Rotate credentials.</strong> Reveal a new agent key once and invalidate its predecessor.</li>
            <li><strong>Update a mandate.</strong> Save a new version with matching on-chain configuration. Historical requests retain the mandate reference used for their decision.</li>
          </ul>
          <p>The weekly counter uses UTC Unix-week boundaries, computed as <code>floor(timestamp / 604800)</code>, not a rolling seven-day window or a local calendar week.</p>
        </section>
        <section id="architecture" className={styles.section}>
          <span id="security" aria-hidden="true" />
          <h2>Two layers, distinct responsibilities</h2>
          <p><strong>GenLayer interprets purpose.</strong> Its intelligent contract evaluates a natural-language mandate against the purchase and evidence, returning an inspectable decision and explanation tied to hashes and a policy version.</p>
          <p><strong>QDay Aevum holds and moves funds.</strong> The vault enforces owner/executor permissions, approved recipients, transaction/weekly/lifetime caps, balance, expiry, policy version, active authorization epoch, suspension, and replay protection. It records settled spending and payment events.</p>
          <p><strong>Vercel, Atlas, and GitHub Actions coordinate execution.</strong> Vercel serves the owner interface and agent API. MongoDB Atlas persists requests, immutable policy history, credential digests, and execution state. A bounded Actions worker checks finality and settles approved requests.</p>
          <div className={styles.callout}><strong>The executor is a trusted cross-chain component.</strong>Aevum does not cryptographically verify GenLayer consensus. A compromised executor can spend within the vault’s contract-enforced authority. This testnet architecture does not claim trustless cross-chain governance.</div>
          <Table headers={["Network setting", "Value"]} rows={[
            ["Payment network", "QDay Aevum Testnet, chain ID 44005"],
            ["RPC", "https://rpc-test.qday.info (HTTPS polling)"],
            ["Settlement token", "tUSD8: 0x456569838f1d43009A91ebA4263147Afd7233483, 6 decimals"],
            ["Native gas", "tQDAY"],
            ["Policy environment", "GenLayer Studio development network, chain ID 61997"],
          ]} />
          <p>Smart-account owner controls use QDay’s ERC-4337 bundler and EntryPoint v0.7. Resume sends the unpause and new mandate together in one UserOperation. The confirmation shows the UserOperation hash and links to the mined Aevum transaction.</p>
        </section>
        <section id="limits" className={styles.section}>
          <h2>Current limits and next steps</h2>
          <p>Owners can register several agents, each with a separate vault. Shared multi-agent vault budgets and delegation are outside the current custody model. API history is bounded to 1000 stored requests and has no cursor pagination. Atlas uses a CAS-versioned aggregate for serialized writes, suitable for this bounded prototype rather than large-scale payment traffic.</p>
          <p>Studio development state may reset; it is not a durable production consensus guarantee. Actions scheduling has variable latency. Semantic evaluation cannot independently validate arbitrary invoice claims, and there is no service-discovery standard or guaranteed fulfillment mechanism.</p>
          <p>Policy simulation, shared-vault multi-agent delegation, verified merchant evidence, scalable indexing, and stronger cross-chain authorization are future work. Mainnet requires operational key controls, persistent governance infrastructure, independent financial-security review, and validated merchant workflows.</p>
        </section>
        <footer className={styles.footer}><span>AgentPay documentation</span><a href="/agents">View your agents</a></footer>
      </main>
    </div>
  </div>;
}
