// The wallets the Agent Reviews team pays from. Their reviews are real paid
// calls, and are always labelled as ours. These addresses are public on-chain,
// so anyone can check the label against a review's payment.
const SEED_WALLETS = new Set([
  "0x04d193a332f38980ec9a5ec87789009ab55b5dde",
  "0x26eb3ad54c12fc7133a2b2b6eddc0692d94ebcea",
])

export const isSeeded = (row: { wallet: string }) =>
  SEED_WALLETS.has(row.wallet.toLowerCase())
