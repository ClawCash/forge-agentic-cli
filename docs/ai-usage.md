# AI usage log

ETHGlobal asks teams to document where and how AI was used, and to include specs, prompts, and planning artifacts.
This file records that, phase by phase.

## Tools

- **Claude Code** (Claude Opus 5.5): research, planning, and writing code under the team's direction. The team reviews
  every change and makes every commit.

## Planning (5–6 November 2026)

- Researched the Arc docs (through the Arc docs MCP server), the ETHGlobal Mumbai prize tracks, the ERC-8004
  specification, and Circle's Discovery API.
- The team wrote the product spec ([spec.md](spec.md)). Claude reviewed it against ERC-8004 and the prize rules.
  Resulting changes: use the spec's `/.well-known/agent-registration.json` for endpoint verification, require the paying
  wallet to sign the review, and target Hedera x402, Arc, and World ID prizes.
- The team chose the prize stack, project name, and workflow. Claude drafted the phase plan ([plan.md](plan.md)).
- Claude researched World's ETHGlobal requirements and the Agent Pass docs and proposed the Phase 6 design (one
  checkpoint guarding counted reviews and payments above the cap). The team approved it.

## Phase 0: scaffold

- Claude generated the workspace skeleton (npm workspaces, TypeScript config, Prettier, CLI and server stubs, smoke
  test) and these docs, following the team's existing stack.
- At the team's request, Claude added `npm start` for Railway and `scripts/new-wallet.ts`, a throwaway testnet wallet
  generator that can write the key straight into `.env`.
- Claude dropped the separate merchant reply wallet (the service owner signs replies, which readers can check against
  `ownerOf(agentId)`) and, at the team's request, created the Railway service, copied the `.env` values to it without
  displaying them, and generated its domain.

## Phase 1: demo seller APIs

- Claude checked public x402 facilitators (x402.org, x402.rs) and found none supporting Arc testnet, so it proposed
  settling payments in-process with the x402 SDK's own facilitator and the EVM `exact` scheme. x402.org does support
  `hedera:testnet`, which Phase 9 will use.
- Claude wrote the invoice extractor, the two demo APIs (A's ASCII-only item pattern is the deliberate limitation), the
  x402 paywall, the ERC-8004 registration files, and their tests.
- `npm audit` reports a moderate advisory in `@hono/node-server`'s `serveStatic`, which this server does not use. The
  fix requires a major upgrade, so it was left as is.

## Phase 2: paying from the agent's wallet

- Claude wrote `reviews pay`, which drives the x402 steps itself instead of using the wrapped `fetch`, so it can time
  the challenge and the paid call separately and read the settlement receipt. It also wrote the shared onchain payment
  check, the local interaction store, and tests against a stand-in seller with a fake facilitator and fake receipts.
- At the team's request, Claude ran the first real payment (agent A → deployed demo API A, Arc testnet) and confirmed
  it against the chain: agent A's balance fell by exactly $0.01 and the service owner paid the gas. Arc emits two
  `Transfer` events per USDC transfer (a system event in 18-decimal native units and the standard 6-decimal one at
  `0x3600…`); the check matches the standard one.

## Phase 3: service identities

- Claude read the identity registry's verified ABI from Arc's explorer (an ERC-1967 proxy to
  `IdentityRegistryUpgradeable`), wrote the registration and verification scripts and the two-way endpoint identity
  check with tests, and moved the registry constants into `shared/`.
- Claude registered both demo services on Arc testnet from the service owner wallet (agents 897804 and 897805),
  saved the IDs to `.env`, and mirrored them to the Railway service as earlier `.env` values were.

## Phase 4: moving to Hedera

- The team dropped Arc: without a mobile consumer app no Arc prize track fit. Claude checked the alternatives:
  World Chain has no ERC-8004 registries and no x402 USDC defaults, while Hedera testnet has the registries at the
  same addresses and x402.org settles `hedera:testnet` payments and pays the fees. The team chose Hedera and World ID.
- Claude rewrote the payment path for Hedera with `@x402/hedera` (the server delegates settlement to x402.org; the CLI
  signs a USDC transfer from the agent's Hedera account, found on the mirror node from its key's EVM address),
  replaced the EVM receipt check with a mirror node check, pointed the ERC-8004 code at Hedera, removed the Arc code,
  and added `hedera:status` for funding and USDC association. The Arc-era entries above are kept as history.
- After the team funded the wallets with HBAR, Claude associated testnet USDC with the three Hedera accounts
  (`0.0.11345199` owner, `0.0.11345215` agent A, `0.0.11345228` agent B), registered both services on Hedera's
  ERC-8004 registry (agents 169 and 170), checked the live 402 terms against x402.org, and updated the Railway
  variables (new agent IDs, `ARC_RPC_URL` removed).
