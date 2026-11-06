import { parseArgs } from "node:util"
import type { Hex } from "viem"
import { OUTCOME_VALUES } from "../../../shared/src/erc8004.ts"
import { HEDERA_TESTNET } from "../../../shared/src/networks.ts"
import { loadAgent } from "../agent.ts"
import { requestApproval } from "../approval.ts"
import type { CliDeps } from "../deps.ts"
import {
  loadInteraction,
  loadSignedFeedback,
  saveSignedFeedback,
} from "../interactions.ts"
import { FeedbackDroppedError } from "../reputation.ts"

export const SUBMIT_USAGE = `Usage: reviews submit <interaction-id> --task <tag> --outcome <outcome> --reason <text>

Reviews a paid interaction. A person first approves it with World ID (scan
the QR code). The reviews server checks that this agent's account made the
payment and stores the review, and the agent writes the score to the ERC-8004
reputation registry on Hedera from its own key. Without approval the review is
stored as unverified and is not written onchain or counted.

If a run stops after the review is stored (for example the Hedera RPC times
out), run the same command again: it finds the stored review and finishes
publishing it, without a new approval and without publishing it twice.

Options:
  --task <tag>         What the agent was trying to do, e.g. invoice-extraction:hi
  --outcome <outcome>  success, partial or failure
  --reason <text>      What worked or failed (public; no secrets or payloads)
  --note <text>        Optional detail
  --server <url>       Reviews server (default: REVIEWS_SERVER or the demo server)
  --unverified         Skip the human approval (stored, not counted)
  --approval <id>      Resume waiting on an approval requested earlier
  --no-wait            Request the approval, print its link and exit; finish
                       later with --approval <id> (for agents)
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
      approval: { type: "string" },
      "no-wait": { type: "boolean", default: false },
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

  // The onchain write and the server's confirmation, shared by new reviews
  // and by reviews an earlier run stored but did not finish publishing.
  const publish = async (review: DraftReview): Promise<number> => {
    let signed = loadSignedFeedback(review.id, deps.env)
    let transaction: Hex | undefined
    for (let attempt = 0; !transaction; attempt++) {
      if (!signed) {
        signed = await deps.reputation.signFeedback(agent.privateKey, {
          agentId: BigInt(review.agentId),
          value: review.value,
          tag1: review.tag1,
          tag2: review.tag2,
          endpoint: review.endpoint,
          feedbackURI: review.feedbackURI,
          feedbackHash: review.feedbackHash,
        })
        // Kept before sending, so a rerun resends this same transaction.
        saveSignedFeedback(review.id, signed, deps.env)
      }
      try {
        transaction = await deps.reputation.sendFeedback(signed)
      } catch (error) {
        if (error instanceof FeedbackDroppedError && attempt === 0) {
          signed = null
          continue
        }
        const message =
          (error as { shortMessage?: string }).shortMessage ??
          (error as Error).message
        throw new Error(
          [
            message,
            `Review ${review.id} is stored but not confirmed onchain yet.`,
            "Run the same command again to finish publishing it; it will not be published twice.",
          ].join("\n")
        )
      }
    }

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

  // A review this payment already backs: an earlier run stored it and then
  // stopped. Finish that review rather than asking for a new approval.
  const listed = await deps.fetch(
    `${server}/reviews?endpoint=${encodeURIComponent(interaction.request.endpoint)}`
  )
  if (!listed.ok) {
    throw new Error(`Could not list reviews: HTTP ${listed.status}`)
  }
  const existing = (await listed.json()) as {
    identity: { agentId?: string }
    reviews: StoredReview[]
  }
  const stored = existing.reviews.find(
    (review) =>
      review.payment.transactionId === interaction.settlement!.transaction &&
      review.reviewer.toLowerCase() === agent.account.address.toLowerCase()
  )
  if (stored) {
    // Resume only the review asked for: one payment backs one review.
    if (stored.task !== values.task || stored.outcome !== values.outcome) {
      throw new Error(
        `This payment already backs a review: ${stored.id} (${stored.task}: ${stored.outcome})`
      )
    }
    deps.stderr(
      `Resuming review ${stored.id}, stored earlier for this payment${stored.reason !== values.reason ? ` with the reason "${stored.reason}"` : ""}.\n`
    )
    if (stored.status === "published") {
      deps.stderr(
        [
          `Reviewed agent ${existing.identity.agentId} for ${stored.task}: ${stored.outcome} (${stored.value}/100)`,
          `Feedback: ${HEDERA_TESTNET.transactionUrl(stored.feedbackTransaction as Hex)}`,
          `Review:   ${stored.feedbackURI}`,
          `Already published as feedback #${stored.feedbackIndex} from ${agent.account.address}`,
          "",
        ].join("\n")
      )
      return 0
    }
    if (!stored.humanVerified) {
      deps.stderr(
        [
          `Review ${stored.id} is stored as unverified (no human approval).`,
          "It is not written onchain and does not count.",
          `Review: ${stored.feedbackURI}`,
          "",
        ].join("\n")
      )
      return 1
    }
    return publish({
      id: stored.id,
      agentId: existing.identity.agentId!,
      value: stored.value,
      tag1: stored.task,
      tag2: stored.outcome,
      endpoint: interaction.request.endpoint,
      feedbackURI: stored.feedbackURI,
      feedbackHash: stored.feedbackHash,
    })
  }

  // A person approves this exact review (endpoint, task, outcome) first.
  let approvalId: string | undefined
  if (!values.unverified && values["no-wait"] && !values.approval) {
    const requested = await requestApproval(
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
      deps,
      undefined,
      false
    )
    const resume = [
      "reviews submit",
      id,
      "--task",
      values.task,
      "--outcome",
      values.outcome,
      "--reason",
      JSON.stringify(values.reason),
      ...(values.note ? ["--note", JSON.stringify(values.note)] : []),
      "--approval",
      requested.id,
    ].join(" ")
    deps.stdout(
      [
        "Approval requested. Ask the person to open this link and approve with World ID:",
        `  ${requested.approvalUrl}`,
        "To show it as a QR code in a terminal, run:",
        `  reviews qr ${requested.id}`,
        "When they have approved, finish the review with:",
        `  ${resume}`,
        "",
      ].join("\n")
    )
    return 0
  }
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
      deps,
      values.approval
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
  const review = draft.json as unknown as DraftReview & {
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
  return publish(review)
}

// A stored review as the server returns it when it is created.
interface DraftReview {
  id: string
  agentId: string
  value: number
  tag1: string
  tag2: string
  endpoint: string
  feedbackURI: string
  feedbackHash: Hex
}

// A review as the server lists it (GET /reviews).
interface StoredReview {
  id: string
  task: string
  outcome: string
  value: number
  reason: string | null
  reviewer: string
  status: "pending" | "published"
  feedbackURI: string
  feedbackHash: Hex
  feedbackTransaction: string | null
  feedbackIndex: string | null
  payment: { transactionId: string }
  humanVerified: boolean
}
