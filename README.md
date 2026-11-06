# forge-agentic-cli

Reviews for x402 APIs, written and read by agents. Before an agent buys an API call, it checks what earlier agents
experienced with that endpoint for the same task. After the call, it leaves a review backed by payment evidence.
Reputation is recorded through ERC-8004, starting on Arc testnet.

Built at ETHGlobal Mumbai (5–7 November 2026). See [the spec](docs/spec.md), [the build plan](docs/plan.md), and
[prior work and references](REFERENCES.md).

## Status

Phase 1: two demo seller APIs behind x402 on Arc testnet. The CLI commands are placeholders.

## Demo seller APIs

Two clearly labelled demo services extract line items from plain-text invoices (format in
[server/src/invoice.ts](server/src/invoice.ts), sample in [tests/fixtures/hindi-invoice.txt](tests/fixtures/hindi-invoice.txt)).
They advertise the same capability, but API A only reads ASCII item descriptions, so it silently drops Hindi line
items. Only reviews can tell an agent that.

| Path | Price | Notes |
|---|---|---|
| `POST /a/invoices/extract` | $0.01 USDC, Arc testnet | Drops non-ASCII line items |
| `POST /b/invoices/extract` | $0.01 USDC, Arc testnet | Handles any script |
| `GET /a/agent-registration.json`, `GET /b/agent-registration.json` | free | ERC-8004 registration files |
| `GET /.well-known/agent-registration.json` | free | ERC-8004 endpoint domain verification |

Unpaid calls get `402 Payment Required` with x402 v2 terms. No public facilitator supports Arc testnet, so the server
settles payments itself: it verifies the buyer's signed EIP-3009 USDC authorization and submits it onchain from the
service owner's wallet, which also receives the payment. Each paid call therefore has its own transaction hash.

Set `DEMO_API_A_AGENT_ID` and `DEMO_API_B_AGENT_ID` after registering the services (Phase 3) to fill in their
registrations. `PUBLIC_BASE_URL` overrides the public origin (on Railway it comes from `RAILWAY_PUBLIC_DOMAIN`).

## Layout

- `cli/`: the `reviews` command (`check`, `pay`, `submit`)
- `server/`: demo seller APIs and the reviews API (Hono)
- `tests/`: `node:test` suites
- `docs/`: spec, phase plan, and the AI-usage log

## Development

Requires Node 22.

```bash
npm install
cp .env.example .env   # testnet keys only
npm run dev:server
npm run reviews -- --help
```

## Test wallets

Generate throwaway testnet wallets. With `--save`, the private key goes straight into `.env` (filling the empty entry
from `.env.example`, never overwriting a set one) and only the address is printed:

```bash
npm run wallet:new -- --save AGENT_A_PRIVATE_KEY
npm run wallet:new        # print a new address and private key instead
```

Fund the printed addresses on Arc testnet at https://faucet.circle.com. Never send real funds to these wallets.

## Deployment

The server runs on Railway as the `forge-agentic-cli` service, deployed from `main`:
https://forge-agentic-cli-production.up.railway.app/health. Railway sets `PORT`; the other variables mirror `.env`.

## Checks

```bash
npm run typecheck
npm test
npx prettier --check "**/*.{ts,mjs,json}"
```
