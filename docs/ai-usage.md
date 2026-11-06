# AI usage log

ETHGlobal asks teams to document where and how AI was used, and to include specs, prompts, and planning artifacts.
This file records that, phase by phase.

## Tools

- **Claude Code** (Claude Opus 5.5): research, planning, and writing code under the team's direction. The team reviews
  every change and makes every commit.
- **Arc Studio**: used for the Arc-specific app pieces (from Phase 8).

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
