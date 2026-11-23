# AgentPay interface and motion direction

AgentPay is payment infrastructure for autonomous agents: agent request, deterministic checks, GenLayer policy evaluation, finalized authorization, tUSD8 settlement on QDay Aevum, and an inspectable receipt. The landing page explains this workflow; `/workspace` completes it; `/docs` teaches owners and agents how to integrate.

## Adapted design prompt

Build a four-part scroll story titled **Agents in Motion**. Use the supplied motion reference's warm shell-pink canvas (`#F1ECEA`), dark ink (`#1F2430`), muted accents (`#938B90`), peach (`#DDAD95`), lavender (`#B0AEC6`), harbour blue (`#7DA3BB`), sand (`#EBC9AE`), rose (`#BF9FA5`), and ice (`#BAD9E6`). Use self-hosted Inter, weights 100–900, with swap loading. Keep accessible body text darker than decorative accent words.

The first viewport must identify the product as payment infrastructure for AI agents and offer immediate access to setup. A fixed navigation bar provides Home, How it works, Your control, Documentation, and Open workspace. Keep navigation and primary actions reachable while the story plays. Do not invent customers, balances, completed payments, service verification, or product claims.

The light hero forms “Agents in Motion” from seven pixel icons. A flying payment-request icon approaches the headline; the icon row gives way to letters. Six service cards rise into a bottom fan. Their subjects are research, APIs, compute, data, storage and agent services. These are capability illustrations, not live transaction records.

Retain the long pinned stage and motion vocabulary: fan → scatter away from text/navigation → centre pile → wheel → three-slot rotation from right to left. Six additional cards describe mandates, budgets, authorization, settlement, receipts, and owner control. Adjacent card centres preserve a 1.05-card-width chord gap. Apply per-card inertia, with frame-rate-independent convergence and staggered weights.

Show “From a request to a receipt. Payments with purpose.” Explain that the agent requests, GenLayer evaluates, and QDay Aevum settles. Link directly to the actual workflow guide. Keep this section distinct from the hero on forward and reverse scroll.

After the wheel finishes and all cards settle within 3px/1°, grow a rounded sky window to full bleed. Use the supplied dawn sky and silent looping video at 0.6×, with a static background when video cannot play. Replace the coastal camera with an AgentPay treasury vault. The vault floats, yaws, and zooms through its authorization dial into a dark transition. Show “Independent agents. Defined authority.” and “Your funds. Your control.” alongside the GenLayer purpose check and Aevum budget, pause, revocation and withdrawal controls.

In the dark manifesto, move a horizontal track with words and pastel labels: “Useful work. Bounded authority. Give agents a mandate to act. Keep a budget on-chain. Every decision. Every payment. Inspectable.” Reveal words and objects as they enter. Finish with a direct setup CTA, docs/agent integrations, and Aevum explorer links.

## Timeline and runtime

The desktop story is 1600vh and manifesto 950vh. The controller uses native scrolling with an independently smoothed visual position, without trapping wheel or keyboard input. Motion is authored in React/TypeScript and CSS; no animation dependency is needed.

| Story progress | Beat |
| --- | --- |
| 0–.06 | Hero scrolls away and disappears before navigation |
| .004–.085 | Fan blends to scatter |
| .05–.075 | Workflow section appears |
| .21–.31 | Cards gather into the centre pile |
| .31–.41 | Pile opens into the wheel |
| .41–.57 | Wheel turns three slots right to left |
| .57–.62 | Wheel settles |
| .62–.74 | Gated sky window grows |
| .74–.88 | Vault yaws and floats |
| .88–.97 | Vault zooms and dark transition closes |
| >.985 | Navigation switches to its dark-surface palette |

Portrait choreography applies when width <820 and width <1.1×height. Landscape phones retain the wide composition with explicit short-screen adjustments. Required QA sizes are 375×812, 320×568, 812×375, 568×320, and 768×1024. Prevent horizontal page overflow and keep every action reachable.

Offer Pause motion. Reduced-motion preference and pausing both replace the tall pinned story with normal reading order, show all text, stop the video, and disable inertia. Clear hidden inline states when changing modes. Section navigation maps to .20/.76 story progress while motion is active and uses native section anchors otherwise. Dispose listeners, animation frames and media when leaving the route.

## Operational UX

The workspace uses the same typography and palette, with quiet task feedback. Wallet sign-in precedes owner setup. Setup is a four-step flow: Your agent → Spending rules → Permissions → Review & create. Validate before advancing; allow editing previous steps; show exact recipient addresses, caps and expiry before signing. Deployment and configuration use real wallet confirmations, followed by API registration. Keep a successfully created vault visible if configuration fails, so retrying can use it.

After setup, prioritize funding the vault and connecting the agent through its scoped API key. Show real treasury balances and settled spending. Payment history preserves decisions, policy references, status, transaction hashes and verifiable receipts. Expose funding, unused-fund withdrawal, pause, revocation and key rotation. Errors explain the next action; pending requests describe asynchronous execution honestly.

The app defaults to live mode and fails closed when live infrastructure is unavailable. The test suite retains an explicitly isolated simulated backend for reproducible financial regressions; it is not the deployed product flow.
