import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { keccak256, stringToBytes } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { run } from "../cli/src/index.ts"
import { loadConfig } from "../server/src/config.ts"
import { memoryStore } from "../server/src/db/store.ts"
import { createApp } from "../server/src/index.ts"
import { fakeLedger, fakeReputation } from "./helpers/ledger.mjs"

const BASE = "https://demo.example"
const A = `${BASE}/a/invoices/extract`
const B = `${BASE}/b/invoices/extract`
const TASK = "invoice-extraction:hi"
const hindiInvoice = readFileSync(
  new URL("./fixtures/hindi-invoice.txt", import.meta.url),
  "utf8"
)

// The full story, in-process: the real demo server with its reviews API, a
// fake Hedera ledger behind x402, and a fake ERC-8004 reputation registry.
async function world() {
  const ownerKey = generatePrivateKey()
  const owner = privateKeyToAccount(ownerKey).address
  const agentAKey = generatePrivateKey()
  const agentBKey = generatePrivateKey()
  const agentA = privateKeyToAccount(agentAKey).address
  const agentB = privateKeyToAccount(agentBKey).address
  const ledger = fakeLedger({
    accounts: {
      [owner]: "0.0.5002",
      [agentA]: "0.0.5001",
      [agentB]: "0.0.5003",
    },
  })
  const reputation = fakeReputation({
    owner,
    agentURIs: {
      7: `${BASE}/a/agent-registration.json`,
      8: `${BASE}/b/agent-registration.json`,
    },
  })
  const store = memoryStore()
  const config = await loadConfig({
    SERVICE_OWNER_HEDERA_ACCOUNT_ID: "0.0.5002",
    PUBLIC_BASE_URL: BASE,
    DEMO_API_A_AGENT_ID: "7",
    DEMO_API_B_AGENT_ID: "8",
  })
  const fetchApp = (url, init) => app.request(url.toString(), init)
  const app = createApp(config, {
    facilitator: ledger.facilitator,
    reviews: {
      store,
      fetch: fetchApp,
      mirror: ledger.mirror,
      registry: reputation.registry,
      receipts: reputation.receipts,
    },
  })
  const home = mkdtempSync(join(tmpdir(), "reviews-flow-"))
  async function cli(...argv) {
    const out = { stdout: "", stderr: "" }
    const code = await run(argv, {
      fetch: fetchApp,
      env: {
        AGENT_A_PRIVATE_KEY: agentAKey,
        AGENT_B_PRIVATE_KEY: agentBKey,
        REVIEWS_HOME: home,
        REVIEWS_SERVER: BASE,
      },
      stdout: (t) => (out.stdout += t),
      stderr: (t) => (out.stderr += t),
      mirror: ledger.mirror,
      reputation,
    })
    return { code, ...out }
  }
  const lastInteractionId = () =>
    readdirSync(join(home, "interactions"))
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        JSON.parse(readFileSync(join(home, "interactions", f), "utf8"))
      )
      .sort((x, y) => x.startedAt.localeCompare(y.startedAt))
      .at(-1).id
  return {
    app,
    cli,
    store,
    reputation,
    agentA,
    agentB,
    home,
    lastInteractionId,
  }
}

test("agent A's review steers agent B away from API A", async () => {
  const w = await world()
  const body = JSON.stringify({ text: hindiInvoice })

  // Agent A pays API A, which drops the Hindi line items.
  const paid = await w.cli("pay", A, "--agent", "a", "--json", body)
  assert.equal(paid.code, 0, paid.stderr)
  assert.equal(JSON.parse(paid.stdout).lineItems.length, 2)

  // Agent A reviews it: stored by the server, written onchain from A's key.
  const submitted = await w.cli(
    "submit",
    w.lastInteractionId(),
    "--task",
    TASK,
    "--outcome",
    "failure",
    "--reason",
    "Dropped 2 of 4 line items (the Hindi ones); items sum 1860.00 vs total 3291.00"
  )
  assert.equal(submitted.code, 0, submitted.stderr)
  assert.match(
    submitted.stderr,
    /Reviewed agent 7 for invoice-extraction:hi: failure \(0\/100\)/
  )
  assert.match(submitted.stderr, /Published as feedback #1/)
  assert.equal(w.reputation.feedback.length, 1)
  assert.equal(w.reputation.feedback[0].client, w.agentA)

  // The document at the feedbackURI hashes to the onchain feedbackHash.
  const onchain = w.reputation.feedback[0]
  const doc = await (await w.app.request(onchain.feedbackURI)).text()
  assert.equal(keccak256(stringToBytes(doc)), onchain.feedbackHash)
  const parsed = JSON.parse(doc)
  assert.equal(parsed.agentId, 7)
  assert.equal(parsed.clientAddress, w.agentA)
  assert.equal(parsed.reported.outcome, "failure")
  assert.equal(parsed.observed.measuredBy, "reviewer's CLI")
  assert.equal(parsed.proofOfPayment.fromAccount, "0.0.5001")
  assert.equal(parsed.evidence.reviewerIsPayer, true)

  // Agent B checks both APIs before buying: A is to avoid, B is unknown.
  const checked = await w.cli("check", A, B, "--task", TASK, "--output", "json")
  assert.equal(checked.code, 0, checked.stderr)
  const report = JSON.parse(checked.stdout)
  const [a, b] = report.reports
  assert.equal(a.verdict, "avoid")
  assert.deepEqual(a.onchain, { count: 1, average: 0 })
  assert.equal(a.reviews[0].reason.startsWith("Dropped 2 of 4"), true)
  assert.equal(a.reviews[0].onchain, true)
  assert.equal(b.verdict, "unknown")
  assert.equal(report.suggestion, B)

  // Agent B pays API B, succeeds, and says so.
  await w.cli("pay", B, "--agent", "b", "--json", body)
  const good = await w.cli(
    "submit",
    w.lastInteractionId(),
    "--task",
    TASK,
    "--outcome",
    "success",
    "--reason",
    "All 4 line items, totals match"
  )
  assert.equal(good.code, 0, good.stderr)

  const after = JSON.parse(
    (await w.cli("check", A, B, "--task", TASK, "--output", "json")).stdout
  )
  assert.equal(after.reports[1].verdict, "recommended")
  assert.equal(after.suggestion, B)

  // The text view an agent or person reads.
  const text = await w.cli("check", A, B, "--task", TASK)
  assert.match(text.stdout, /Demo Invoice API A \(agent 7, verified\)/)
  assert.match(text.stdout, /✗ failure: Dropped 2 of 4/)
  assert.match(
    text.stdout,
    /Suggested: https:\/\/demo\.example\/b\/invoices\/extract \(recommended\)/
  )
})

test("only trusted reviewers count when a list is given", async () => {
  const w = await world()
  await w.cli(
    "pay",
    A,
    "--agent",
    "a",
    "--json",
    JSON.stringify({ text: hindiInvoice })
  )
  await w.cli(
    "submit",
    w.lastInteractionId(),
    "--task",
    TASK,
    "--outcome",
    "failure",
    "--reason",
    "x"
  )
  const checked = JSON.parse(
    (
      await w.cli(
        "check",
        A,
        "--task",
        TASK,
        "--reviewers",
        w.agentB,
        "--output",
        "json"
      )
    ).stdout
  )
  assert.deepEqual(checked.reports[0].onchain, { count: 0, average: null })
  assert.equal(checked.reports[0].verdict, "unknown")
  assert.equal(checked.reports[0].reviews[0].trusted, false)
})

test("the server refuses reviews it cannot back with a payment", async () => {
  const w = await world()
  const body = JSON.stringify({ text: hindiInvoice })
  await w.cli("pay", A, "--agent", "a", "--json", body)
  const first = w.lastInteractionId()
  const submit = await w.cli(
    "submit",
    first,
    "--task",
    TASK,
    "--outcome",
    "failure",
    "--reason",
    "x"
  )
  assert.equal(submit.code, 0, submit.stderr)

  // The same payment cannot back a second review.
  const again = await w.cli(
    "submit",
    first,
    "--task",
    TASK,
    "--outcome",
    "success",
    "--reason",
    "y"
  )
  assert.equal(again.code, 1)
  assert.match(again.stderr, /already backs a review/)

  // A second, unreviewed payment by agent A to use in hand-made drafts.
  await w.cli("pay", A, "--agent", "a", "--json", body)
  const second = JSON.parse(
    readFileSync(
      join(w.home, "interactions", `${w.lastInteractionId()}.json`),
      "utf8"
    )
  )
  const draft = (overrides = {}) => ({
    endpoint: A,
    task: TASK,
    outcome: "failure",
    reason: "x",
    reviewer: w.agentA,
    payment: {
      network: "hedera:testnet",
      transactionId: second.settlement.transaction,
      asset: "0.0.429274",
      amount: "10000",
      payTo: "0.0.5002",
      payer: "0.0.5001",
    },
    observed: { httpStatus: 200, totalMs: 1, paidCallMs: 1, responseBytes: 1 },
    interaction: { id: second.id, requestSha256: null, responseSha256: "00" },
    ...overrides,
  })
  const post = (path, payload) =>
    w.app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

  // Someone else's payment: the reviewer is not the payer.
  const notPayer = await post("/reviews", draft({ reviewer: w.agentB }))
  assert.equal(notPayer.status, 422)
  assert.match(
    (await notPayer.json()).error,
    /reviewer is not the account that paid/
  )

  // A payment that never happened.
  const fake = await post(
    "/reviews",
    draft({
      payment: {
        ...draft().payment,
        transactionId: "0.0.9185802@1731000000.000000999",
      },
    })
  )
  assert.equal(fake.status, 422)
  assert.match((await fake.json()).error, /Payment not verified/)

  // An endpoint that is not a verified agent.
  const unknown = await post(
    "/reviews",
    draft({ endpoint: `${BASE}/c/nothing` })
  )
  assert.equal(unknown.status, 422)
  assert.match((await unknown.json()).error, /not a verified ERC-8004 agent/)

  // A valid draft is stored as pending, and publishing it needs a matching
  // NewFeedback event: the first review's transaction does not match it.
  const pending = await post("/reviews", draft())
  assert.equal(pending.status, 201)
  const { id } = await pending.json()
  const wrongEvent = await post(`/reviews/${id}/publish`, {
    transaction: w.reputation.feedback[0].hash,
  })
  assert.equal(wrongEvent.status, 422)
  assert.match((await wrongEvent.json()).error, /No matching NewFeedback event/)
  const missing = await post(`/reviews/${id}/publish`, {
    transaction: `0x${"11".repeat(32)}`,
  })
  assert.equal(missing.status, 409)
  assert.equal((await w.store.get(id)).status, "pending")
})

test("check reports unknown endpoints without failing", async () => {
  const w = await world()
  const checked = JSON.parse(
    (
      await w.cli(
        "check",
        `${BASE}/c/nothing`,
        "--task",
        TASK,
        "--output",
        "json"
      )
    ).stdout
  )
  assert.equal(checked.reports[0].identity.status, "unknown")
  assert.equal(checked.reports[0].verdict, "unknown")
})
