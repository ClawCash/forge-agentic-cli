# World ID Agent Pass: integration debrief

ETHGlobal Mumbai, 7 November 2026. Track: World ID Agent Pass.

## What it protects

Two agent actions need a verified person behind the agent, each approved with a fresh World ID sign-in:

- **Publishing a counted review.** A review is written to the ERC-8004 reputation registry on Hedera only after a
  person approves that exact review (endpoint, task and outcome). The approval also caps counted reviews at one per
  person, service and task, using the app-specific World ID subject (stored hashed). Without approval the review is
  stored as unverified, is not written onchain, and does not count.
- **Paying above the agent's spending cap.** The CLI pauses until a person approves the specific payment.

Flow: the CLI shows a QR code for the approval page → the person opens it and signs in with World ID (authorization
code + PKCE, `max_age=0`) → the server exchanges the code with client secret Basic auth and verifies the ID token
against World's JWKS (issuer, audience, RS256 signature, nonce, `auth_time` after the request, `acr` present) → the
approval is consumed atomically by the one action it was granted for. Denied, cancelled, expired, unverified-account,
replayed and mismatched approvals all leave the protected action undone (see `tests/approvals.test.mjs` and
`tests/world.test.mjs`).

## Time to first success

_To fill in after the first live approval._ Code to a passing local flow (with a stand-in World and real ID token
checks against a local key set): about 1.5 hours.

## Friction

- The Agent Pass docs at auth.world.org/docs render client-side, so they could not be read by tools or quickly
  skimmed without a browser; the discovery document was the most reliable reference.
- The portal offers "Selfie Check" as an accepted account type, but `acr_values_supported` in the discovery document
  lists only `orb` and `orb-face`, so it was unclear what `acr` a Selfie Check account receives.
- The prize page notes that proofs currently use mocked identities, so it was unclear whether a real World ID can be
  used in the demo.

## Missing capabilities or docs

- A documented list of `acr`/`amr` values per account type and authentication method, with example ID tokens.
- A "human approval for an agent action" recipe: binding an approval to specific action details (we pass them in our
  own approval record; a standard way, such as an authorization details parameter, would help).
- A sandbox switch documented next to the client registration, so teams know which environment their client is in.

## Highest-impact improvement

Publish the ID token contract (claims, `acr` values per account type, freshness semantics of `max_age` and
`auth_time`) on a plain, readable docs page with one complete example.
