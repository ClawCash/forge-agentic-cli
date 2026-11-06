import { randomUUID } from "node:crypto"
import { Hono } from "hono"
import { type Hex, keccak256, parseEventLogs, stringToBytes } from "viem"
import { z } from "zod"
import {
  HEDERA_TESTNET_REGISTRIES,
  OUTCOME_VALUES,
  reputationRegistryAbi,
} from "../../shared/src/erc8004.ts"
import { checkPayment, type EvidenceDeps } from "../../shared/src/evidence.ts"
import { addressForAccountId } from "../../shared/src/hedera.ts"
import {
  type EndpointIdentity,
  resolveEndpointIdentity,
} from "../../shared/src/identity.ts"
import { HEDERA_TESTNET } from "../../shared/src/networks.ts"
import { consumeApproval } from "./approvals.ts"
import {
  DuplicateHumanReviewError,
  DuplicateReviewError,
  type ReviewStore,
  type StoredReview,
} from "./db/store.ts"

// Reviews API. A review is accepted only when the endpoint is a verified
// ERC-8004 agent, the reviewer is the account that paid, the payment went to
// the agent's owner, and the mirror node confirms it. The server then stores
// the review document (served at its feedbackURI) and marks it published once
// the reviewer's own giveFeedback transaction is found onchain.

export interface ReviewDeps {
  store: ReviewStore
  baseUrl: string
  fetch: typeof fetch
  mirror: EvidenceDeps
  registry: Parameters<typeof resolveEndpointIdentity>[1]["registry"]
  receipts: {
    getTransactionReceipt(args: { hash: Hex }): Promise<{
      status: "success" | "reverted"
      logs: Parameters<typeof parseEventLogs>[0]["logs"]
    }>
  }
}

const TaskTag = z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,63}$/, {
  message: "lowercase letters, digits and : . _ - (up to 64)",
})

const ReviewDraft = z.object({
  endpoint: z.url(),
  task: TaskTag,
  outcome: z.enum(["success", "partial", "failure"]),
  reason: z.string().trim().min(1).max(500),
  note: z.string().trim().max(2000).optional(),
  reviewer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  payment: z.object({
    network: z.literal(HEDERA_TESTNET.id),
    transactionId: z.string().max(80),
    asset: z.literal(HEDERA_TESTNET.usdc),
    amount: z.string().regex(/^\d+$/),
    payTo: z.string().regex(/^0\.0\.\d+$/),
    payer: z.string().regex(/^0\.0\.\d+$/),
  }),
  observed: z.object({
    httpStatus: z.number().int(),
    totalMs: z.number().int().nonnegative(),
    paidCallMs: z.number().int().nonnegative(),
    responseBytes: z.number().int().nonnegative(),
  }),
  interaction: z.object({
    id: z.string().max(64),
    requestSha256: z.string().max(64).nullable(),
    responseSha256: z.string().max(64),
  }),
  // A World ID approval for this review; without one the review is stored as
  // not human-verified and is not counted.
  approvalId: z
    .string()
    .regex(/^apr_[0-9a-f-]{36}$/)
    .optional(),
})

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function isPublicHttpsUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  return (
    url.protocol === "https:" &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(host) &&
    !host.startsWith("[") &&
    host.includes(".") &&
    !/(^|\.)(localhost|internal|local)$/.test(host)
  )
}

function publicReview(row: StoredReview, baseUrl: string) {
  const doc = JSON.parse(row.document)
  return {
    id: row.id,
    task: row.task,
    outcome: row.outcome,
    value: row.value,
    reason: doc.reported?.reason ?? null,
    note: doc.reported?.note ?? null,
    reviewer: row.reviewer,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    feedbackURI: `${baseUrl}/reviews/${row.id}.json`,
    feedbackHash: row.documentHash,
    feedbackTransaction: row.feedbackTransaction,
    feedbackIndex: row.feedbackIndex,
    payment: {
      transactionId: row.paymentTransaction,
      evidence: doc.evidence?.payment ?? null,
    },
    observed: doc.observed ?? null,
    humanVerified: row.humanVerified,
  }
}

export function reviewRoutes(deps: ReviewDeps) {
  const app = new Hono()
  const identities = new Map<
    string,
    { at: number; identity: EndpointIdentity }
  >()

  // Identity checks fetch URLs chosen by others (the endpoint's domain, and an
  // agentURI anyone can register onchain), so only public HTTPS URLs are
  // fetched and redirects are not followed: a review can't make the server
  // probe its own private network.
  const publicFetch: typeof fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    return isPublicHttpsUrl(url)
      ? deps.fetch(input, { ...init, redirect: "error" })
      : Promise.reject(new Error(`Only public HTTPS URLs are fetched: ${url}`))
  }

  async function identityOf(endpoint: string) {
    const cached = identities.get(endpoint)
    if (cached && Date.now() - cached.at < 60_000) return cached.identity
    const identity = await resolveEndpointIdentity(endpoint, {
      fetch: publicFetch,
      registry: deps.registry,
    })
    if (identity.status === "verified") {
      identities.set(endpoint, { at: Date.now(), identity })
    }
    return identity
  }

  app.post("/reviews", async (c) => {
    const parsed = ReviewDraft.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json(
        { error: "Invalid review", issues: parsed.error.issues },
        400
      )
    }
    const draft = parsed.data
    const reject = (error: string) => c.json({ error }, 422)

    const identity = await identityOf(draft.endpoint)
    if (identity.status !== "verified") {
      return reject(
        `The endpoint is not a verified ERC-8004 agent: ${identity.reason}`
      )
    }
    const [payerAddress, payToAddress] = await Promise.all([
      addressForAccountId(draft.payment.payer, deps.mirror),
      addressForAccountId(draft.payment.payTo, deps.mirror),
    ])
    if (!same(payerAddress, draft.reviewer)) {
      return reject("The reviewer is not the account that paid")
    }
    if (!same(payToAddress, identity.owner)) {
      return reject("The payment did not go to the service's ERC-8004 owner")
    }
    const evidence = await checkPayment(
      {
        transactionId: draft.payment.transactionId,
        token: draft.payment.asset,
        from: draft.payment.payer,
        to: draft.payment.payTo,
        amount: BigInt(draft.payment.amount),
      },
      deps.mirror
    )
    if (evidence.status !== "verified") {
      return reject(`Payment not verified: ${evidence.reason}`)
    }

    // Consumed only after every other check passed, so a refused review
    // does not burn the person's approval.
    let approval = null
    if (draft.approvalId) {
      const result = await consumeApproval(
        deps.store,
        draft.approvalId,
        {
          agent: draft.reviewer,
          action: "review",
          details: {
            endpoint: draft.endpoint,
            task: draft.task,
            outcome: draft.outcome,
          },
        },
        new Date()
      )
      if ("error" in result) return reject(`Approval refused: ${result.error}`)
      approval = result
    }

    const id = `rev_${randomUUID()}`
    const value = OUTCOME_VALUES[draft.outcome]
    // The offchain feedback file (ERC-8004 recommended fields first). What the
    // agent reports and what its CLI measured are kept apart.
    const document = JSON.stringify(
      {
        agentRegistry: identity.agentRegistry,
        agentId: Number(identity.agentId),
        clientAddress: draft.reviewer,
        createdAt: new Date().toISOString(),
        value,
        valueDecimals: 0,
        tag1: draft.task,
        tag2: draft.outcome,
        endpoint: draft.endpoint,
        proofOfPayment: {
          fromAddress: payerAddress,
          toAddress: payToAddress,
          chainId: draft.payment.network,
          txHash: draft.payment.transactionId,
          fromAccount: draft.payment.payer,
          toAccount: draft.payment.payTo,
          asset: draft.payment.asset,
          amount: draft.payment.amount,
        },
        reported: {
          outcome: draft.outcome,
          reason: draft.reason,
          note: draft.note ?? null,
        },
        observed: { ...draft.observed, measuredBy: "reviewer's CLI" },
        evidence: {
          payment: "verified on the Hedera mirror node",
          consensusTimestamp: evidence.consensusTimestamp,
          reviewerIsPayer: true,
          paidServiceOwner: true,
          humanApproval: approval
            ? {
                verified: true,
                provider: "World ID Agent Pass",
                acr: approval.acr,
                approvedAt: approval.decidedAt?.toISOString() ?? null,
              }
            : { verified: false },
        },
        interaction: draft.interaction,
      },
      null,
      2
    )
    try {
      const row = await deps.store.insert({
        id,
        agentRegistry: identity.agentRegistry,
        agentId: identity.agentId,
        endpoint: draft.endpoint,
        task: draft.task,
        outcome: draft.outcome,
        value,
        reviewer: draft.reviewer,
        paymentTransaction: draft.payment.transactionId,
        document,
        documentHash: keccak256(stringToBytes(document)),
        humanVerified: approval !== null,
        humanSubject: approval?.humanSubject ?? null,
        approvalId: approval?.id ?? null,
      })
      return c.json(
        {
          id: row.id,
          agentId: row.agentId,
          value,
          tag1: row.task,
          tag2: row.outcome,
          endpoint: row.endpoint,
          feedbackURI: `${deps.baseUrl}/reviews/${row.id}.json`,
          feedbackHash: row.documentHash,
          humanVerified: row.humanVerified,
        },
        201
      )
    } catch (error) {
      if (
        error instanceof DuplicateReviewError ||
        error instanceof DuplicateHumanReviewError
      ) {
        return c.json({ error: error.message }, 409)
      }
      throw error
    }
  })

  app.get("/reviews/:file", async (c) => {
    const id = c.req.param("file").replace(/\.json$/, "")
    const row = await deps.store.get(id)
    if (!row) return c.json({ error: "No such review" }, 404)
    return c.body(row.document, 200, { "Content-Type": "application/json" })
  })

  app.post("/reviews/:id/publish", async (c) => {
    const row = await deps.store.get(c.req.param("id"))
    if (!row) return c.json({ error: "No such review" }, 404)
    const body = z
      .object({ transaction: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: "Send {transaction: 0x…}" }, 400)
    if (row.status === "published") {
      return c.json(publicReview(row, deps.baseUrl))
    }
    let receipt
    try {
      receipt = await deps.receipts.getTransactionReceipt({
        hash: body.data.transaction as Hex,
      })
    } catch {
      return c.json({ error: "Transaction not found yet" }, 409)
    }
    if (receipt.status !== "success") {
      return c.json({ error: "The feedback transaction reverted" }, 422)
    }
    const uri = `${deps.baseUrl}/reviews/${row.id}.json`
    const event = parseEventLogs({
      abi: reputationRegistryAbi,
      eventName: "NewFeedback",
      logs: receipt.logs,
    }).find(
      (log) =>
        same(log.address, HEDERA_TESTNET_REGISTRIES.reputation) &&
        log.args.agentId.toString() === row.agentId &&
        same(log.args.clientAddress, row.reviewer) &&
        log.args.feedbackURI === uri &&
        same(log.args.feedbackHash, row.documentHash)
    )
    if (!event) {
      return c.json(
        {
          error:
            "No matching NewFeedback event from the reviewer for this review",
        },
        422
      )
    }
    const published = await deps.store.markPublished(row.id, {
      feedbackTransaction: body.data.transaction,
      feedbackIndex: event.args.feedbackIndex.toString(),
    })
    return c.json(publicReview(published, deps.baseUrl))
  })

  app.get("/reviews", async (c) => {
    const endpoint = c.req.query("endpoint")
    const task = c.req.query("task")
    if (!endpoint || !URL.canParse(endpoint)) {
      return c.json({ error: "Pass ?endpoint=<url>" }, 400)
    }
    if (task !== undefined && !TaskTag.safeParse(task).success) {
      return c.json({ error: "Invalid task tag" }, 400)
    }
    const identity = await identityOf(endpoint)
    if (identity.status !== "verified") {
      return c.json({ identity, reviews: [] })
    }
    const rows = await deps.store.list({ agentId: identity.agentId, task })
    return c.json({
      identity,
      reviews: rows.map((row) => publicReview(row, deps.baseUrl)),
    })
  })

  return app
}
