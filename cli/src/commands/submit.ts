import { parseArgs } from "node:util"
import type { Hex } from "viem"
import { OUTCOME_VALUES } from "../../../shared/src/erc8004.ts"
import { HEDERA_TESTNET } from "../../../shared/src/networks.ts"
import { loadAgent } from "../agent.ts"
import { requestApproval } from "../approval.ts"
import type { CliDeps } from "../deps.ts"
import { loadInteraction } from "../interactions.ts"

export const SUBMIT_USAGE = `Usage: reviews submit <interaction-id> --task <tag> --outcome <outcome> --reason <text>

Reviews a paid interaction. A person first approves it with World ID (scan
the QR code). The reviews server checks that this agent's account made the
payment and stores the review, and the agent writes the score to the ERC-8004
reputation registry on Hedera from its own key. Without approval the review is
stored as unverified and is not written onchain or counted.

Options:
  --task <tag>         What the agent was trying to do, e.g. invoice-extraction:hi
  --outcome <outcome>  success, partial or failure
  --reason <text>      What worked or failed (public; no secrets or payloads)
  --note <text>        Optional detail
  --server <url>       Reviews server (default: REVIEWS_SERVER or the demo server)
  --unverified         Skip the human approval (stored, not counted)
`

export const DEFAULT_SERVER =
  "https://forge-agentic-cli-production.up.railway.app"

export async function runSubmit(
  argv: string[],
  deps: CliDeps
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      task: { type: "string" },
      outcome: { type: "string" },
      reason: { type: "string" },
      note: { type: "string" },
      server: { type: "string" },
      unverified: { type: "boolean", default: false },
    },
  })
  const [id] = positionals
  if (!id || !values.task || !values.outcome || !values.reason) {
    deps.stderr(SUBMIT_USAGE)
    return 1
  }
  if (!(values.outcome in OUTCOME_VALUES)) {
    throw new Error("--outcome must be success, partial or failure")
  }
  const interaction = loadInteraction(id, deps.env)
  if (!interaction.price || !interaction.settlement?.success) {
    throw new Error("Only paid, settled interactions can be reviewed")
  }
  const agent = loadAgent(interaction.agent.name, deps.env)
  if (agent.account.address !== interaction.agent.address) {
    throw new Error("This interaction was paid by a different key")
  }
  const server = (
    values.server ??
    deps.env.REVIEWS_SERVER ??
    DEFAULT_SERVER
  ).replace(/\/$/, "")
  const post = async (path: string, body: unknown) => {
    const res = await deps.fetch(`${server}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, json }
  }

  // A person approves this exact review (endpoint, task, outcome) first.
  let approvalId: string | undefined
  if (!values.unverified) {
    const approval = await requestApproval(
      server,
      {
        action: "review",
        agent: agent.account.address,
        details: {
          endpoint: interaction.request.endpoint,
          task: values.task,
          outcome: values.outcome,
        },
      },
      deps
    )
    if (approval.status === "approved") {
      approvalId = approval.id
      deps.stderr("Approved with World ID.\n")
    } else {
      deps.stderr(
        `Not approved (${approval.status}${approval.reason ? `: ${approval.reason}` : ""}). The review will be stored as unverified.\n`
      )
    }
  }

  const draft = await post("/reviews", {
    endpoint: interaction.request.endpoint,
    task: values.task,
    outcome: values.outcome,
    reason: values.reason,
    note: values.note,
    reviewer: agent.account.address,
    payment: {
      network: interaction.price.network,
      transactionId: interaction.settlement.transaction,
      asset: interaction.price.asset,
      amount: interaction.price.amount,
      payTo: interaction.price.payTo,
      payer: interaction.agent.accountId,
    },
    observed: {
      httpStatus: interaction.response.status,
      totalMs: interaction.timings.totalMs,
      paidCallMs: interaction.timings.paidCallMs,
      responseBytes: interaction.response.bytes,
    },
    approvalId,
    interaction: {
      id: interaction.id,
      requestSha256: interaction.request.bodySha256,
      responseSha256: interaction.response.bodySha256,
    },
  })
  if (draft.status !== 201) {
    throw new Error(
      `The reviews server refused the review: ${draft.json.error ?? draft.status}`
    )
  }
  const review = draft.json as {
    id: string
    agentId: string
    value: number
    tag1: string
    tag2: string
    endpoint: string
    feedbackURI: string
    feedbackHash: Hex
    humanVerified: boolean
  }
  if (!review.humanVerified) {
    deps.stderr(
      [
        `Stored review ${review.id} as unverified (no human approval).`,
        "It is not written onchain and does not count.",
        `Review: ${review.feedbackURI}`,
        "",
      ].join("\n")
    )
    return 1
  }

  const transaction = await deps.reputation.giveFeedback(agent.privateKey, {
    agentId: BigInt(review.agentId),
    value: review.value,
    tag1: review.tag1,
    tag2: review.tag2,
    endpoint: review.endpoint,
    feedbackURI: review.feedbackURI,
    feedbackHash: review.feedbackHash,
  })

  let published = await post(`/reviews/${review.id}/publish`, { transaction })
  for (let attempt = 1; published.status === 409 && attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    published = await post(`/reviews/${review.id}/publish`, { transaction })
  }

  deps.stderr(
    [
      `Reviewed agent ${review.agentId} for ${review.tag1}: ${review.tag2} (${review.value}/100)`,
      `Feedback: ${HEDERA_TESTNET.transactionUrl(transaction)}`,
      `Review:   ${review.feedbackURI}`,
      published.status === 200
        ? `Published as feedback #${published.json.feedbackIndex} from ${agent.account.address}`
        : `The server has not confirmed it yet: ${published.json.error ?? published.status}`,
      "",
    ].join("\n")
  )
  return published.status === 200 ? 0 : 1
}
