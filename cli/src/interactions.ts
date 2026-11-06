import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { PaymentEvidence } from "../../shared/src/evidence.ts"

// One paid (or attempted) call, recorded by `reviews pay` and reviewed later
// with `reviews submit <id>`. Everything here was measured by the CLI, never
// supplied by the agent.
export interface Interaction {
  id: string
  agent: { name: string; address: string; accountId: string }
  request: {
    endpoint: string
    method: string
    bodySha256: string | null
  }
  startedAt: string
  price: {
    network: string
    asset: string
    amount: string
    amountUsd: string
    payTo: string
    scheme: string
  } | null
  timings: { challengeMs: number | null; paidCallMs: number; totalMs: number }
  response: {
    status: number
    contentType: string | null
    bytes: number
    bodySha256: string
  }
  settlement: {
    success: boolean
    transaction: string
    network: string
    payer: string | null
    explorerUrl: string | null
  } | null
  evidence: PaymentEvidence | null
}

export function reviewsHome(env = process.env) {
  return (
    env.REVIEWS_HOME ??
    join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "forge-agentic-cli")
  )
}

function interactionsDir(env = process.env) {
  const dir = join(reviewsHome(env), "interactions")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

// The response body is kept locally (the agent needs it to judge the task)
// but never leaves this machine as part of a review.
export function saveInteraction(
  interaction: Interaction,
  body: Uint8Array,
  env = process.env
) {
  const dir = interactionsDir(env)
  writeFileSync(
    join(dir, `${interaction.id}.json`),
    `${JSON.stringify(interaction, null, 2)}\n`
  )
  writeFileSync(join(dir, `${interaction.id}.body`), body)
}

export function loadInteraction(id: string, env = process.env): Interaction {
  if (!/^int_[0-9a-f-]{36}$/.test(id))
    throw new Error(`Invalid interaction id: ${id}`)
  return JSON.parse(
    readFileSync(join(interactionsDir(env), `${id}.json`), "utf8")
  )
}
