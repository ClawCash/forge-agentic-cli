import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { A, B, hindiInvoice, TASK, world } from "./helpers/story.mjs"
import { actOnApproval } from "./helpers/world.mjs"

const body = JSON.stringify({ text: hindiInvoice })

const post = (app, path, payload) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

test("an approved review is human-verified, written onchain and labelled", async () => {
  const w = await world()
  await w.cli("pay", A, "--agent", "a", "--json", body)
  const submit = await w.cli(
    "submit",
    w.lastInteractionId(),
    "--task",
    TASK,
    "--outcome",
    "failure",
    "--reason",
    "Dropped Hindi items"
  )
  assert.equal(submit.code, 0, submit.stderr)
  assert.match(submit.stderr, /Approved with World ID/)
  assert.equal(w.reputation.feedback.length, 1)

  const [review] = await w.store.list({ agentId: "7" })
  assert.equal(review.humanVerified, true)
  assert.match(review.humanSubject, /^[0-9a-f]{64}$/)
  const doc = JSON.parse(review.document)
  assert.equal(doc.evidence.humanApproval.verified, true)
  assert.equal(doc.evidence.humanApproval.provider, "World ID Agent Pass")
  assert.equal(doc.evidence.humanApproval.acr, "https://world.org/oidc/acr/orb")
  assert.equal(
    JSON.stringify(doc).includes(review.humanSubject),
    false,
    "the subject stays off the public document"
  )

  const check = await w.cli("check", A, "--task", TASK)
  assert.match(check.stdout, /human-approved \(World ID\)/)
})

for (const choice of ["deny", "cancel"]) {
  test(`a ${choice === "deny" ? "denied" : "cancelled"} approval stores the review unverified and keeps it off-chain`, async () => {
    const w = await world()
    await w.cli("pay", A, "--agent", "a", "--json", body)
    w.human.choice = choice
    const submit = await w.cli(
      "submit",
      w.lastInteractionId(),
      "--task",
      TASK,
      "--outcome",
      "failure",
      "--reason",
      "x"
    )
    assert.equal(submit.code, 1)
    assert.match(
      submit.stderr,
      choice === "deny"
        ? /Not approved \(denied: Denied by the person\)/
        : /Not approved \(denied: The World ID sign-in was cancelled\)/
    )
    assert.match(submit.stderr, /not written onchain and does not count/)
    assert.equal(
      w.reputation.feedback.length,
      0,
      "the protected action did not happen"
    )
    const [review] = await w.store.list({ agentId: "7" })
    assert.equal(review.humanVerified, false)
  })
}

test("an account without a verified World ID is not accepted", async () => {
  const w = await world()
  await w.cli("pay", A, "--agent", "a", "--json", body)
  w.human.acr = null
  const submit = await w.cli(
    "submit",
    w.lastInteractionId(),
    "--task",
    TASK,
    "--outcome",
    "failure",
    "--reason",
    "x"
  )
  assert.equal(submit.code, 1)
  assert.match(submit.stderr, /Not a verified World ID \(no acr\)/)
  assert.equal(w.reputation.feedback.length, 0)
})

test("one person gets one counted review per service and task", async () => {
  const w = await world()
  const review = async () => {
    await w.cli("pay", A, "--agent", "a", "--json", body)
    return w.cli(
      "submit",
      w.lastInteractionId(),
      "--task",
      TASK,
      "--outcome",
      "failure",
      "--reason",
      "x"
    )
  }
  assert.equal((await review()).code, 0)
  const second = await review()
  assert.equal(second.code, 1)
  assert.match(
    second.stderr,
    /already has a counted review for this endpoint and task/
  )

  // A different person, or the same person on another service, still counts.
  w.human.person = "person-2"
  assert.equal((await review()).code, 0)
  w.human.person = "person-1"
  await w.cli("pay", B, "--agent", "a", "--json", body)
  const other = await w.cli(
    "submit",
    w.lastInteractionId(),
    "--task",
    TASK,
    "--outcome",
    "success",
    "--reason",
    "y"
  )
  assert.equal(other.code, 0, other.stderr)
})

test("approvals expire, are used once, and only back what was approved", async () => {
  const w = await world({ approvalTtlMs: 50 })
  const request = {
    action: "review",
    agent: w.agentA,
    details: { endpoint: A, task: TASK, outcome: "failure" },
  }

  // Expired: nobody acted in time.
  const late = await (await post(w.app, "/approvals", request)).json()
  await new Promise((resolve) => setTimeout(resolve, 80))
  const status = await (
    await w.app.request(new URL(late.statusUrl).pathname)
  ).json()
  assert.equal(status.status, "expired")
  const page = await (
    await w.app.request(new URL(late.approvalUrl).pathname)
  ).text()
  assert.match(page, /Expired/)

  // Only for what was approved: an approval for a failure review cannot back
  // a success review, and one agent's approval cannot back another's.
  const v = await world()
  await v.cli("pay", A, "--agent", "a", "--json", body)
  const interaction = JSON.parse(
    readFileSync(
      join(v.home, "interactions", `${v.lastInteractionId()}.json`),
      "utf8"
    )
  )
  const approval = await (
    await post(v.app, "/approvals", { ...request, agent: v.agentA })
  ).json()
  const approvedPage = await actOnApproval(
    v.app,
    v.world,
    approval.approvalUrl,
    { person: "p" }
  )
  assert.match(await approvedPage.text(), /Approved/)
  const draft = (overrides) => ({
    endpoint: A,
    task: TASK,
    outcome: "failure",
    reason: "x",
    reviewer: v.agentA,
    payment: {
      network: "hedera:testnet",
      transactionId: interaction.settlement.transaction,
      asset: "0.0.429274",
      amount: "10000",
      payTo: "0.0.5002",
      payer: "0.0.5001",
    },
    observed: { httpStatus: 200, totalMs: 1, paidCallMs: 1, responseBytes: 1 },
    interaction: {
      id: interaction.id,
      requestSha256: null,
      responseSha256: "00",
    },
    approvalId: approval.id,
    ...overrides,
  })
  const mismatch = await post(v.app, "/reviews", draft({ outcome: "success" }))
  assert.equal(mismatch.status, 422)
  assert.match((await mismatch.json()).error, /different outcome/)
  const accepted = await post(v.app, "/reviews", draft({}))
  assert.equal(accepted.status, 201)
  assert.equal((await accepted.json()).humanVerified, true)
  const replay = await post(v.app, `/approvals/${approval.id}/consume`, {
    agent: v.agentA,
    action: "review",
  })
  assert.equal(replay.status, 409)
  assert.match((await replay.json()).error, /already used/)
})

test("a payment above the cap waits for a person's approval", async () => {
  const w = await world()
  const paid = await w.cli(
    "pay",
    A,
    "--agent",
    "a",
    "--json",
    body,
    "--max-usd",
    "0.005"
  )
  assert.equal(paid.code, 0, paid.stderr)
  assert.match(paid.stderr, /\$0\.01 is above --max-usd 0\.005/)
  assert.match(paid.stderr, /Payment approved with World ID/)
  const interaction = JSON.parse(
    readFileSync(
      join(w.home, "interactions", `${w.lastInteractionId()}.json`),
      "utf8"
    )
  )
  assert.match(interaction.approvalId, /^apr_/)

  w.human.choice = "deny"
  const refused = await w.cli(
    "pay",
    A,
    "--agent",
    "a",
    "--json",
    body,
    "--max-usd",
    "0.005"
  )
  assert.equal(refused.code, 1)
  assert.match(refused.stderr, /payment was not approved \(denied/)

  const noAsk = await w.cli(
    "pay",
    A,
    "--agent",
    "a",
    "--json",
    body,
    "--max-usd",
    "0.005",
    "--no-approval"
  )
  assert.equal(noAsk.code, 1)
  assert.match(noAsk.stderr, /above --max-usd 0\.005\n/)
})

test("agents can request an approval, hand over the link, and finish later", async () => {
  const w = await world()
  await w.cli("pay", B, "--agent", "b", "--json", body)
  const id = w.lastInteractionId()
  const args = [
    "--task",
    TASK,
    "--outcome",
    "success",
    "--reason",
    "All 4 line items",
  ]

  // Step 1 returns at once with the link and the command that finishes it.
  const requested = await w.cli("submit", id, ...args, "--no-wait")
  assert.equal(requested.code, 0, requested.stderr)
  const link = /(https:\/\/\S+\/approvals\/apr_[0-9a-f-]{36})/.exec(
    requested.stdout
  )?.[1]
  const approvalId = /--approval (apr_[0-9a-f-]{36})/.exec(
    requested.stdout
  )?.[1]
  assert.ok(link && approvalId, requested.stdout)
  assert.match(
    requested.stdout,
    new RegExp(`reviews submit ${id} --task ${TASK}`)
  )
  assert.equal(
    (await w.store.list({ agentId: "8" })).length,
    0,
    "nothing stored yet"
  )
  assert.equal(w.reputation.feedback.length, 0)

  // The person approves; then the agent finishes the review.
  await actOnApproval(w.app, w.world, link, { person: "person-9" })
  const finished = await w.cli("submit", id, ...args, "--approval", approvalId)
  assert.equal(finished.code, 0, finished.stderr)
  assert.match(finished.stderr, /Approved with World ID/)
  assert.equal(w.reputation.feedback.length, 1)
  const [review] = await w.store.list({ agentId: "8" })
  assert.equal(review.humanVerified, true)
})
