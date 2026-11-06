# Build plan

Target prizes: Hedera "AI Agents That Pay: x402 on Hedera", Arc "Best Mobile Web Consumer Agent Using the Marketplace
Discovery API", and World "World ID Agent Pass". Each phase ends with working code and several small commits.

| # | Phase | Done when |
|---|---|---|
| 0 | Scaffold: workspaces, configs, CLI and server stubs, docs | Typecheck and tests pass on the skeleton |
| 1 | Demo seller APIs A and B (invoice extraction; A misses Hindi line items) with x402 on Arc testnet and an ERC-8004 domain-verification file | An unpaid call returns a 402 payment request |
| 2 | `reviews pay`: pay from the agent's own wallet and record the receipt (settlement transaction, price, timing, status) | One real Arc testnet payment end to end |
| 3 | Register both services on the ERC-8004 identity registry (Arc testnet) and verify their domains | Both agent IDs visible on the explorer |
| 4 | Review write path: review schema, Postgres store, content hash, `giveFeedback` with proof of payment, payer = reviewer check | `reviews submit` produces a feedback transaction |
| 5 | `reviews check <endpoint> --task`: live Circle Discovery results (unreviewed ones shown as unknown) plus reviews from allowlisted reviewers | Agent B's check shows agent A's review |
| 6 | World ID Agent Pass: one human checkpoint guards counted reviews and payments above the spending cap (see below) | Approved, cancelled and expired paths all shown |
| 7 | Agent skill and scripted demo agents A and B with a Hindi invoice fixture and a task checker | The demo story runs from one command |
| 8 | Merchant page and mobile agent screen, built with Arc Studio | Live page with reviews, failure reasons and merchant replies |
| 9 | Hedera x402 payments on the demo APIs; reviews reference Hedera settlements | A Hedera payment linked on HashScan, reviewed |
| 10 | Submission: architecture diagram, track documents, demo video script | Ready to submit |

## Phase 6: World ID Agent Pass

Agent Pass is World's OpenID Connect sign-in at auth.world.org. Proofs currently use mocked identities, so production
use must wait for World.

Protected actions, both behind one approval checkpoint:

- **Counted review.** A review is written onchain as counted only after the human behind the reviewing agent signs in
  fresh. Their pairwise World ID subject caps counted reviews at one per human, endpoint and task.
- **Payment above the spending cap.** The CLI pauses until the human approves the payment.

Flow:

1. The CLI creates a pending operation on the server and shows a QR code linking to the server's approval page.
2. The approval page starts the sign-in with state, nonce, PKCE and `max_age=0` (fresh authentication).
3. The server checks the ID token against World's published signing keys (issuer, audience, nonce and `auth_time`)
   and records the approval. The client's response is never trusted on its own.
4. The CLI polls, then runs the action. The server rechecks the approval and consumes it atomically, so it works once.

Failure paths: if the human cancels or the approval expires, the review is stored as unverified and not counted, and
the payment never runs.

The team registers the client in auth.world.org/portal with the deployed callback URL and puts the client ID and secret
in `.env`. The submission includes the integration debrief World asks for: time to first success, friction, missing
capabilities or docs, and the single highest-impact improvement.

## Out of scope

A new marketplace, a custom token, paid review incentives, complex reputation scoring, and full Forge analytics.
