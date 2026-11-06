# Prior work and references

All code in this repository was written during ETHGlobal Mumbai (5–7 November 2026). No code, designs, or assets were
copied from earlier projects. The commit history shows the work as it happened.

## Earlier projects by the same team that informed the design

These were read as references only. Their ideas shaped this project; their code was not reused.

- **Forge** (forgeintel.co, private). An agent-commerce intelligence product: discovery and rankings of x402 services
  across marketplaces, agent-readiness scoring, and merchant-side feedback collection. It informed the problem
  statement (agents pay to discover limitations other agents already found) and the idea of separating observed
  measurements from agent-reported opinions.
- **ClawCash** (private; its CLI is published as `@clawcash/cli`). A prepaid payment layer for agents. It informed how
  to parse an x402 `402 Payment Required` response, choose a payment option by network, pay through Circle Gateway
  nanopayments, read the settlement transaction from the paid response, and check a USDC transfer in a transaction
  receipt.

## Public libraries and standards

- [x402](https://github.com/x402-foundation/x402): HTTP payment protocol
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004): trustless agents (identity, reputation, validation registries)
- [Hedera](https://docs.hedera.com) and [`@x402/hedera`](https://www.npmjs.com/package/@x402/hedera): x402 payments in
  USDC on Hedera testnet, settled through the [x402.org facilitator](https://x402.org/facilitator)
- [Hono](https://hono.dev), [viem](https://viem.sh)

## AI assistance

See [docs/ai-usage.md](docs/ai-usage.md).
