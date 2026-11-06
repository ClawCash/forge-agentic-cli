// Shows each demo wallet's Hedera testnet account, HBAR and USDC.
//
//   npm run hedera:status                  balances only
//   npm run hedera:status -- --associate   also associate testnet USDC where missing
//
// A wallet gets a Hedera account the first time testnet HBAR is sent to its
// EVM address (https://portal.hedera.com/faucet). Both payer and merchant
// must be associated with USDC before a payment can settle.

import { parseArgs } from "node:util"
import {
  AccountId,
  Client,
  PrivateKey,
  TokenAssociateTransaction,
  TokenId,
} from "@x402/hedera"
import type { Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { accountIdForAddress } from "../shared/src/hedera.ts"
import { HEDERA_TESTNET, formatUsdc } from "../shared/src/networks.ts"

const WALLETS = ["SERVICE_OWNER", "AGENT_A", "AGENT_B"]
const { values } = parseArgs({
  options: { associate: { type: "boolean", default: false } },
})
const mirror = (path: string) =>
  fetch(`${HEDERA_TESTNET.mirrorNode}/api/v1${path}`).then((res) => res.json())

for (const wallet of WALLETS) {
  const key = process.env[`${wallet}_PRIVATE_KEY`]
  if (!key) {
    console.log(`${wallet}: ${wallet}_PRIVATE_KEY is not set`)
    continue
  }
  const { address } = privateKeyToAccount(key as Hex)
  const accountId = await accountIdForAddress(address, { fetch })
  if (!accountId) {
    console.log(
      `${wallet} ${address}: no Hedera account yet — send it testnet HBAR`
    )
    continue
  }
  const account = await mirror(`/accounts/${accountId}`)
  const hbar = Number(account.balance?.balance ?? 0) / 1e8
  const tokens = await mirror(
    `/accounts/${accountId}/tokens?token.id=${HEDERA_TESTNET.usdc}`
  )
  const usdc = tokens.tokens?.[0]
  const usdcText = usdc
    ? `${formatUsdc(BigInt(usdc.balance), HEDERA_TESTNET.usdcDecimals)} USDC`
    : "USDC not associated"
  console.log(
    `${wallet} ${address} → ${accountId}: ${hbar.toFixed(2)} HBAR, ${usdcText}`
  )

  if (!usdc && values.associate) {
    const client = Client.forTestnet().setOperator(
      AccountId.fromString(accountId),
      PrivateKey.fromStringECDSA(key)
    )
    try {
      const response = await new TokenAssociateTransaction()
        .setAccountId(AccountId.fromString(accountId))
        .setTokenIds([TokenId.fromString(HEDERA_TESTNET.usdc)])
        .execute(client)
      const receipt = await response.getReceipt(client)
      console.log(
        `  associated USDC: ${receipt.status.toString()} ${HEDERA_TESTNET.transactionUrl(response.transactionId.toString())}`
      )
    } finally {
      client.close()
    }
  }
}
