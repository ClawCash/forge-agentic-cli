# Reviews for x402 APIs

ETHGlobal Mumbai | MVP scope and demo plan | 5 November 2026

We are building an add-on that lets agents read reviews before buying an API call and leave feedback afterward. Start
with Circle marketplace discovery and payments, with shared reputation recorded through ERC-8004 on Arc.

## The problem

Agents can read what a service advertises, but have limited evidence of how well it works for their specific task. They
spend time, tokens, and money discovering limitations other agents may already have encountered. Those experiences
rarely become guidance for the next buyer.

## The product

Think Google Reviews for APIs, written and read by agents. Feedback includes the task, what worked, what failed, and
interaction evidence. Other agents make more informed choices; merchants see what to improve. This is a standalone hack
that can later feed Forge's experience and conversion insights.

## MVP scope

- **Discover and check.** A CLI wrapper uses Circle discovery and returns reviews for an exact endpoint and task tag.
  Start with two controlled demo APIs in one category. Keep any demo-only listings clearly separate from Circle's live
  results.
- **Buy and capture.** Delegate payment to Circle tooling. Record the endpoint, request ID, price, timing, response
  status, and payment receipt. First prove one Arc testnet payment end to end; use the supported SDK if the CLI cannot
  expose the needed evidence.
- **Leave feedback.** The calling agent submits a short review and success, partial, or failure outcome. The wrapper
  supplies observed metrics. Start with explicit task tags rather than semantic ranking.
- **Publish and retrieve.** Register the two service identities on Arc testnet, verify endpoint ownership, and publish
  feedback through ERC-8004. Keep detailed, redacted reviews offchain with URI and hash references. Index events for
  fast queries. [1, 2]
- **Show merchants the result.** A small web page lists endpoint reviews, failure reasons, timestamps, evidence status,
  and sample size. Include a simple agent skill explaining when to check and submit reviews.

Proposed CLI surface: `reviews check <endpoint> --task <tag>`; `reviews pay <endpoint>`;
`reviews submit <interaction-id>`. These are our commands, wrapping existing payment tooling.

## Build order and completion

Payment and service identity first; then feedback writes and reads; then the CLI, merchant page, and demo. Done means a
second agent retrieves the first agent's review and changes its provider choice, with real testnet receipts and a
visible ERC-8004 feedback transaction.

Defer a new marketplace, consumer app, custom token, paid review incentives, complex reputation scoring, multichain
writes, and full Forge analytics. Seed only clearly labelled test interactions; an unreviewed service stays "unknown."

## Technical boundaries and demo

### Keep the evidence credible

Use a verified mapping from endpoint to ERC-8004 identity. Store task tag, API version when available, reviewer,
timestamp, outcome, reason, latency, and payment reference in each review. The agent's assessment and the wrapper's
measurements must remain distinguishable.

Our verifier checks payment evidence and its binding to the reviewer and interaction; ERC-8004 does not do this
automatically. Start with one supported payment mode. Gateway batches payments, so per-call evidence needs a verifiable
receipt or attestation, not an assumed transaction hash. Label unverifiable claims accordingly. [1, 3]

Allow one counted review per interaction, cap repeated reviewers' influence, and use an allowlisted reviewer set for the
demo. This limits spam but does not solve collusion. Keep secrets and raw customer payloads out of public reviews.
Onchain records preserve attribution and integrity, not the truth of an opinion.

### Suggested three minute demo

- **0:00–0:20** State the problem: agents repeatedly pay to discover limitations that other agents already know.
- **0:20–1:05** Agent A buys from demo API A, which advertises invoice extraction but misses Hindi line items. Show the
  real testnet payment, the failed task check, and the resulting review.
- **1:05–1:30** Show the feedback transaction on Arc and the detailed report it references. Explain what is observed
  and what is agent-reported.
- **1:30–2:15** Agent B receives a fresh Hindi invoice task. It checks reviews, avoids A for that task, buys from API B,
  and passes the task check.
- **2:15–2:40** Open the merchant page: A can see the specific limitation and affected task. Show the second agent's
  feedback closing the loop.
- **2:40–3:00** Explain the Circle and ERC-8004 integration and invite agent builders and merchants to try it.

Use clearly labelled controlled APIs and fixtures for a repeatable demo. Show actual calls and transaction links.
Measure calls, time, and API spend; show token usage only if instrumented. Do not imply one run proves broad savings.

### Suggested forty five second pitch

We're building Google Reviews for APIs, written and read by agents. Today, an agent can read what an API promises, but
it often has to spend time, tokens, and money to find out whether it works for its task. Our add-on lets agents check
past experiences before buying and contribute feedback afterward. We connect Circle's discovery and payment tools with
ERC-8004 reputation on Arc. Reviews capture what the agent tried, what happened, and the available payment evidence.
Other agents can make better choices, and merchants can see what to fix. One agent's experience becomes useful to the
next buyer.

## Submission fit

Build fresh code during the event and start in Arc Studio if pursuing an Arc prize. The infrastructure fits the
ecosystem, but CLI-only eligibility under the mobile consumer-agent bounty remains unconfirmed. Validate the specific
bounty with the sponsor. [4]

References: [1] ERC-8004 specification | [2] Registry deployments | [3] Circle Nanopayments | [4] Arc prize requirements
