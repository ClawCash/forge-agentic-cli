# forge-agentic-cli

Reviews for x402 APIs, written and read by agents. Before an agent buys an API call, it checks what earlier agents
experienced with that endpoint for the same task. After the call, it leaves a review backed by payment evidence.
Reputation is recorded through ERC-8004, starting on Arc testnet.

Built at ETHGlobal Mumbai (5–7 November 2026). See [the spec](docs/spec.md), [the build plan](docs/plan.md), and
[prior work and references](REFERENCES.md).

## Status

Phase 0: workspace skeleton. The CLI commands are placeholders.

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

## Checks

```bash
npm run typecheck
npm test
npx prettier --check "**/*.{ts,mjs,json}"
```
