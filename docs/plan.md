# Build plan

Target prizes: Hedera "AI Agents That Pay: x402 on Hedera" and World "World ID Agent Pass". Everything runs on Hedera
testnet: x402 payments in USDC, and ERC-8004 identities and reviews. Each phase ends with working code and several
small commits.

Phases 1–3 were first built on Arc testnet. On 7 November the team dropped Arc: without a mobile consumer app, no Arc
prize track fit, and Hedera supports x402 settlement through x402.org and has the ERC-8004 registries at the same
addresses. Phase 4 moves the work to Hedera.

| # | Phase | Done when |
|---|---|---|
| 0 | Scaffold: workspaces, configs, CLI and server stubs, docs | Typecheck and tests pass on the skeleton |
| 1 | Demo seller APIs A and B (invoice extraction; A misses Hindi line items) with x402 and ERC-8004 registration files | An unpaid call returns a 402 payment request |
| 2 | `reviews pay`: pay from the agent's own wallet and record the receipt (settlement transaction, price, timing, status) | One real payment end to end |
| 3 | ERC-8004 identities for both services and a two-way endpoint identity check | Both agent IDs visible on the explorer |
| 4 | Move to Hedera: demo APIs settle USDC through x402.org on Hedera testnet, `reviews pay` pays on Hedera and checks the payment on the mirror node, services re-registered on Hedera's ERC-8004 registry; Arc removed | A Hedera payment linked on HashScan; both services verified on Hedera |
| 5 | Review write path: review schema, Postgres store, content hash, `giveFeedback` with proof of payment, payer = reviewer check | `reviews submit` produces a feedback transaction |
| 6 | `reviews check <endpoint> --task`: reviews from allowlisted reviewers for a verified endpoint; unreviewed services stay unknown | Agent B's check shows agent A's review |
| 7 | World ID Agent Pass: one human checkpoint guards counted reviews and payments above the spending cap (see below) | Approved, cancelled and expired paths all shown |
| 8 | Agent skill and scripted demo agents A and B with a Hindi invoice fixture and a task checker | The demo story runs from one command |
| 9 | Submission: README with settled Hedera transaction IDs, architecture diagram, World debrief, demo video (5 minutes at most, HashScan links) | Ready to submit |

Stretch, only if time allows: a small read-only merchant page served by the server.

## Phase 7: World ID Agent Pass

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

A new marketplace, a mobile app, a custom token, paid review incentives, complex reputation scoring, and full Forge
analytics.
