import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { x402Client, x402HTTPClient } from "@x402/core/client"
import type { PaymentRequirements } from "@x402/core/types"
import { createClientHederaSigner, PrivateKey } from "@x402/hedera"
import { ExactHederaScheme } from "@x402/hedera/exact/client"
import {
  checkPayment,
  type EvidenceDeps,
} from "../../../shared/src/evidence.ts"
import { accountIdForAddress } from "../../../shared/src/hedera.ts"
import {
  formatUsdc,
  PAYMENT_NETWORKS,
  parseUsd,
} from "../../../shared/src/networks.ts"
import { loadAgent } from "../agent.ts"
import type { CliDeps } from "../deps.ts"
import { type Interaction, saveInteraction } from "../interactions.ts"

export const PAY_USAGE = `Usage: reviews pay <endpoint> --agent <name> [options]

Calls a paid x402 endpoint from the agent's own wallet and records the receipt.
The response body goes to stdout; the receipt summary goes to stderr.

Options:
  --agent <name>       Wallet to pay from: AGENT_<NAME>_PRIVATE_KEY
  --json <body>        JSON request body (sent as POST)
  --body-file <path>   Read the JSON request body from a file
  --method <method>    HTTP method (default: POST with a body, else GET)
  --max-usd <amount>   Refuse to pay more than this (default: 0.10)
  --output json        Print one JSON object with the receipt and body
`

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex")

function selectAccept(
  accepts: PaymentRequirements[],
  maxAtomic: (decimals: number) => bigint
) {
  const rejected: string[] = []
  for (const accept of accepts) {
    const network = PAYMENT_NETWORKS[accept.network]
    if (accept.scheme !== "exact" || !network) {
      rejected.push(`${accept.scheme} on ${accept.network} (unsupported)`)
      continue
    }
    if (accept.asset.toLowerCase() !== network.usdc.toLowerCase()) {
      rejected.push(`${accept.asset} on ${network.label} (not USDC)`)
      continue
    }
    const amount = BigInt(accept.amount)
    if (amount > maxAtomic(network.usdcDecimals)) {
      rejected.push(
        `$${formatUsdc(amount, network.usdcDecimals)} on ${network.label} (above --max-usd)`
      )
      continue
    }
    return { accept, network, amount }
  }
  throw new Error(
    `No acceptable payment option: ${rejected.join("; ") || "none offered"}`
  )
}

export async function runPay(argv: string[], deps: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agent: { type: "string" },
      json: { type: "string" },
      "body-file": { type: "string" },
      method: { type: "string" },
      "max-usd": { type: "string", default: "0.10" },
      output: { type: "string" },
    },
  })
  const [endpoint] = positionals
  if (!endpoint || !values.agent) {
    deps.stderr(PAY_USAGE)
    return 1
  }
  const url = new URL(endpoint)
  const agent = loadAgent(values.agent, deps.env)
  const body =
    values.json ??
    (values["body-file"]
      ? readFileSync(values["body-file"], "utf8")
      : undefined)
  if (body !== undefined) JSON.parse(body) // fail early on malformed JSON
  const method = (
    values.method ?? (body === undefined ? "GET" : "POST")
  ).toUpperCase()
  const headers: Record<string, string> =
    body === undefined ? {} : { "Content-Type": "application/json" }
  const maxUsd = values["max-usd"]

  const mirror = deps.mirror ?? { fetch }
  const accountId = await accountIdForAddress(agent.account.address, mirror)
  if (!accountId) {
    throw new Error(
      `${agent.account.address} has no Hedera testnet account yet; send it testnet HBAR first`
    )
  }
  const signer = createClientHederaSigner(
    accountId,
    PrivateKey.fromStringECDSA(agent.privateKey),
    { network: "hedera:testnet" }
  )
  const client = new x402Client().register(
    "hedera:*",
    new ExactHederaScheme(signer)
  )
  const http402 = new x402HTTPClient(client)

  const startedAt = new Date()
  const t0 = performance.now()
  let response = await deps.fetch(url, { method, headers, body })
  let challengeMs: number | null = null
  let price: Interaction["price"] = null
  let paidStart = t0

  if (response.status === 402) {
    challengeMs = Math.round(performance.now() - t0)
    const challengeBody = await response.json().catch(() => undefined)
    const required = http402.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      challengeBody
    )
    const { accept, network, amount } = selectAccept(
      required.accepts,
      (decimals) => parseUsd(maxUsd, decimals)
    )
    price = {
      network: accept.network,
      asset: accept.asset,
      amount: accept.amount,
      amountUsd: formatUsdc(amount, network.usdcDecimals),
      payTo: accept.payTo,
      scheme: accept.scheme,
    }
    const payload = await http402.createPaymentPayload({
      ...required,
      accepts: [accept],
    })
    paidStart = performance.now()
    response = await deps.fetch(url, {
      method,
      headers: { ...headers, ...http402.encodePaymentSignatureHeader(payload) },
      body,
    })
  }
  const responseBody = new Uint8Array(await response.arrayBuffer())
  const paidCallMs = Math.round(performance.now() - paidStart)
  const totalMs = Math.round(performance.now() - t0)

  let settlement: Interaction["settlement"] = null
  if (price && response.headers.get("payment-response")) {
    const settle = http402.getPaymentSettleResponse((name) =>
      response.headers.get(name)
    )
    settlement = {
      success: settle.success,
      transaction: settle.transaction,
      network: settle.network,
      payer: settle.payer ?? null,
      explorerUrl: settle.transaction
        ? (PAYMENT_NETWORKS[settle.network]?.transactionUrl(
            settle.transaction
          ) ?? null)
        : null,
    }
  }

  let evidence: Interaction["evidence"] = null
  if (price && settlement?.success && settlement.transaction) {
    evidence = await checkPayment(
      {
        transactionId: settlement.transaction,
        token: price.asset,
        from: accountId,
        to: price.payTo,
        amount: BigInt(price.amount),
      },
      mirror
    )
  }

  const interaction: Interaction = {
    id: `int_${randomUUID()}`,
    agent: { name: agent.name, address: agent.account.address, accountId },
    request: {
      endpoint: url.toString(),
      method,
      bodySha256: body === undefined ? null : sha256(body),
    },
    startedAt: startedAt.toISOString(),
    price,
    timings: { challengeMs, paidCallMs, totalMs },
    response: {
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: responseBody.byteLength,
      bodySha256: sha256(responseBody),
    },
    settlement,
    evidence,
  }
  saveInteraction(interaction, responseBody, deps.env)

  const text = new TextDecoder().decode(responseBody)
  if (values.output === "json") {
    deps.stdout(`${JSON.stringify({ interaction, body: text }, null, 2)}\n`)
  } else {
    deps.stdout(text.endsWith("\n") ? text : `${text}\n`)
    deps.stderr(summary(interaction))
  }
  return response.ok ? 0 : 1
}

function summary(i: Interaction) {
  const lines: string[] = []
  const seconds = (i.timings.totalMs / 1000).toFixed(2)
  if (i.price) {
    const label = PAYMENT_NETWORKS[i.price.network]?.label ?? i.price.network
    lines.push(
      `Paid $${i.price.amountUsd} USDC on ${label} to ${i.price.payTo} — HTTP ${i.response.status} in ${seconds}s`
    )
  } else {
    lines.push(`No payment required — HTTP ${i.response.status} in ${seconds}s`)
  }
  if (i.settlement) {
    const check =
      i.evidence?.status === "verified"
        ? "verified on the mirror node"
        : `not verified: ${i.evidence?.reason ?? "settlement failed"}`
    lines.push(
      `Settlement: ${i.settlement.explorerUrl ?? i.settlement.transaction} (${check})`
    )
  } else if (i.price) {
    lines.push("Settlement: none reported by the server")
  }
  lines.push(`Interaction: ${i.id}  →  reviews submit ${i.id}`)
  return `${lines.join("\n")}\n`
}
