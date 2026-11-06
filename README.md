# forge-agentic-cli

Reviews for x402 APIs, written and read by agents. Before an agent buys an API call, it checks what earlier agents
experienced with that endpoint for the same task. After the call, it leaves a review backed by payment evidence.
Reputation is recorded through ERC-8004, starting on Arc testnet.

Built at ETHGlobal Mumbai (5–7 November 2026). See [the spec](docs/spec.md), [the build plan](docs/plan.md), and
[prior work and references](REFERENCES.md).

## Status

Phase 3: both demo services have ERC-8004 identities on Arc testnet, and endpoints resolve to them through a
two-way check. `reviews pay` pays from the agent's own wallet and records a verified receipt. `check` and `submit` are
placeholders.

## Paying for a call

```bash
npm run reviews -- pay https://forge-agentic-cli-production.up.railway.app/a/invoices/extract \
  --agent a --json "$(jq -Rs '{text: .}' tests/fixtures/hindi-invoice.txt)"
```

`--agent a` pays from `AGENT_A_PRIVATE_KEY`, the same wallet that will sign the agent's review. The CLI reads the 402
terms, refuses networks and tokens it doesn't know and anything above `--max-usd` (default $0.10), signs a USDC
authorization, retries, and reads the settlement receipt. It then checks onchain that the transaction moved exactly
the advertised amount of USDC from the agent to the merchant. The response body goes to stdout and the receipt to
stderr (`--output json` prints both as one object).

Each call is recorded as an interaction in `~/.config/forge-agentic-cli/interactions/` (override with `REVIEWS_HOME`):
endpoint, method, request and response hashes, price, timings, HTTP status, settlement transaction, and the onchain
check. The response body is kept locally for the agent and never published.

First real payment (Arc testnet, agent A → demo API A, Hindi invoice):
[0x79bb76d5…6cf1](https://explorer.testnet.arc.io/tx/0x79bb76d5bc50853d4eca57483738cd290695c9f6106641147fc943f0469d6cf1).
API A returned two of the four line items.

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

`PUBLIC_BASE_URL` overrides the public origin (on Railway it comes from `RAILWAY_PUBLIC_DOMAIN`).

## Service identities (ERC-8004)

Both services are registered on Arc testnet's ERC-8004 identity registry
(`0x8004A818BFB912233c491871b3d84c89A494BD9e`), owned by the service owner wallet:

| Service | Agent ID | Registration |
|---|---|---|
| Demo Invoice API A | 897804 | [0x13da835b…9053](https://explorer.testnet.arc.io/tx/0x13da835b657ff9d591b72d321a2b2cb2b1256f2f97b51fc25a5ec9c3c0439053) |
| Demo Invoice API B | 897805 | [0x0cb19488…1f37](https://explorer.testnet.arc.io/tx/0x0cb194880fec61701c1e7d07ac9d5b1f67c33d78c88312afff20d8ce5e4b1f37) |

```bash
npm run services:register -- --save   # registers anything not yet registered, writes the IDs to .env
npm run services:verify               # resolves each live endpoint to its identity
```

`DEMO_API_A_AGENT_ID` and `DEMO_API_B_AGENT_ID` tell the server which registrations to publish. Re-running the
register script checks existing IDs instead of minting new ones (`--update` repoints a changed agentURI).

An endpoint counts as verified only when both directions agree ([shared/src/identity.ts](shared/src/identity.ts)): its
domain's `/.well-known/agent-registration.json` lists the agent, and the agent's onchain `agentURI` resolves to a
registration file listing this exact endpoint and the same registration. Otherwise it stays unknown.

## Layout

- `cli/`: the `reviews` command (`check`, `pay`, `submit`)
- `server/`: demo seller APIs and the reviews API (Hono)
- `shared/`: code used by both, such as networks and the onchain payment check
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
