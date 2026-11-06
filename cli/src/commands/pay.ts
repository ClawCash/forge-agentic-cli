import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { x402Client, x402HTTPClient } from "@x402/core/client"
import type { PaymentRequirements } from "@x402/core/types"
import { createClientHederaSigner, PrivateKey } from "@x402/hedera"
import { ExactHederaScheme } from "@x402/hedera/exact/client"
import { checkPayment } from "../../../shared/src/evidence.ts"
import { accountIdForAddress } from "../../../shared/src/hedera.ts"
import {
  formatUsdc,
  PAYMENT_NETWORKS,
  parseUsd,
} from "../../../shared/src/networks.ts"
import { loadAgent } from "../agent.ts"
import { requestApproval } from "../approval.ts"
import type { CliDeps } from "../deps.ts"
import { type Interaction, saveInteraction } from "../interactions.ts"
import { DEFAULT_SERVER } from "./submit.ts"

export const PAY_USAGE = `Usage: reviews pay <endpoint> --agent <name> [options]

Calls a paid x402 endpoint from the agent's own wallet and records the receipt.
The response body goes to stdout; the receipt summary goes to stderr.

Options:
  --agent <name>       Wallet to pay from: AGENT_<NAME>_PRIVATE_KEY
                       (default: REVIEWS_AGENT)
  --json <body>        JSON request body (sent as POST)
  --body-file <path>   Read the JSON request body from a file
  --method <method>    HTTP method (default: POST with a body, else GET)
  --max-usd <amount>   Spending cap per call (default: 0.10). Above it, a person
                       must approve the payment with World ID (QR code)
  --no-approval        Refuse prices above the cap instead of asking
  --output json        Print one JSON object with the receipt and body
  --server <url>       Approvals server (default: REVIEWS_SERVER or the demo server)
`

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex")

// The first USDC option on a supported network. Whether it is above the
// spending cap is decided by the caller.
function selectAccept(accepts: PaymentRequirements[]) {
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
    return { accept, network, amount: BigInt(accept.amount) }
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
      server: { type: "string" },
      "no-approval": { type: "boolean", default: false },
    },
  })
  const [endpoint] = positionals
  const agentName = values.agent ?? deps.env.REVIEWS_AGENT
  if (!endpoint || !agentName) {
    deps.stderr(PAY_USAGE)
    return 1
  }
  const url = new URL(endpoint)
  const agent = loadAgent(agentName, deps.env)
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
  let approvalId: string | null = null

  if (response.status === 402) {
    challengeMs = Math.round(performance.now() - t0)
    const challengeBody = await response.json().catch(() => undefined)
    const required = http402.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      challengeBody
    )
    const { accept, network, amount } = selectAccept(required.accepts)
    const amountUsd = formatUsdc(amount, network.usdcDecimals)
    if (amount > parseUsd(maxUsd, network.usdcDecimals)) {
      const over = `$${amountUsd} is above --max-usd ${maxUsd}`
      if (values["no-approval"]) throw new Error(over)
      approvalId = await approvePayment(
        { endpoint: url.toString(), amountUsd, network: network.label },
        agent.account.address,
        values.server,
        over,
        deps
      )
    }
    price = {
      network: accept.network,
      asset: accept.asset,
      amount: accept.amount,
      amountUsd,
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
    approvalId,
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

// A person approves one payment above the cap; the approval is consumed
// before paying, so it cannot be reused.
async function approvePayment(
  details: Record<string, string>,
  agent: string,
  serverOption: string | undefined,
  over: string,
  deps: CliDeps
) {
  const server = (
    serverOption ??
    deps.env.REVIEWS_SERVER ??
    DEFAULT_SERVER
  ).replace(/[/]$/, "")
  deps.stderr(`${over}.` + "\n")
  let approval
  try {
    approval = await requestApproval(
      server,
      { action: "payment", agent, details },
      deps
    )
  } catch (error) {
    throw new Error(`${over}; ${(error as Error).message}`)
  }
  if (approval.status !== "approved") {
    throw new Error(
      `${over} and the payment was not approved (${approval.status}${approval.reason ? `: ${approval.reason}` : ""})`
    )
  }
  const res = await deps.fetch(`${server}/approvals/${approval.id}/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, action: "payment" }),
  })
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(
      `${over}; the approval could not be used: ${error ?? res.status}`
    )
  }
  deps.stderr("Payment approved with World ID." + "\n")
  return approval.id
}
