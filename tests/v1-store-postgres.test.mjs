import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import postgres from "postgres"
import {
  PaymentAlreadyReviewedError,
  postgresApiReviewStore,
} from "../server/src/v1/store.ts"

// Runs against a real database only when one is provided, like
// store-postgres.test.mjs.
const url = process.env.REVIEWS_TEST_DATABASE_URL

test(
  "the Postgres store migrates and behaves like the memory store",
  { skip: !url },
  async () => {
    const database = `reviews_v1_test_${randomUUID().replaceAll("-", "")}`
    const admin = postgres(url, { max: 1, onnotice: () => {} })
    await admin.unsafe(`create database ${database}`)
    const scopedUrl = new URL(url)
    scopedUrl.pathname = `/${database}`
    let store
    try {
      store = await postgresApiReviewStore(scopedUrl.toString())
      const review = {
        id: "rev_1",
        domain: "stableenrich.dev",
        path: "/api/x",
        url: "https://stableenrich.dev/api/x",
        task: "enrichment",
        language: null,
        format: null,
        result: "full",
        listing: "accurate",
        satisfaction: "satisfied",
        satisfactionFrom: "agent",
        problems: ["stale"],
        checked: null,
        payAgain: null,
        tries: 2,
        note: null,
        noteStatus: "none",
        wallet: "0xabc",
        network: "eip155:8453",
        paymentReference: "eip155:8453:0x1",
        asset: "0xusdc",
        amountAtomic: "10000",
        priceUsd: 0.01,
        paidAt: new Date(),
        proofMethod: "siwx",
        userId: null,
      }
      const row = await store.insert(review)
      assert.deepEqual(row.problems, ["stale"])
      await assert.rejects(
        store.insert({ ...review, id: "rev_2" }),
        PaymentAlreadyReviewedError
      )
      assert.equal((await store.listByDomains(["stableenrich.dev"])).length, 1)
      assert.equal((await store.listByTask("enrichment")).length, 1)
      assert.equal((await store.listRecent(10)).length, 1)
      const profile = {
        domain: "stableenrich.dev",
        name: "StableEnrich",
        description: "Data for agents.",
        iconType: "image/png",
        iconData: "aWNvbg==",
        siteUrl: "https://stableenrich.dev",
        fetchedAt: new Date(),
      }
      await store.saveProfile(profile)
      await store.saveProfile({ ...profile, name: "Renamed" })
      const profiles = await store.getProfiles(["stableenrich.dev", "none.dev"])
      assert.equal(profiles.size, 1)
      assert.equal(profiles.get("stableenrich.dev").name, "Renamed")
      assert.deepEqual(
        [...(await store.usedReferences(["eip155:8453:0x1", "other"]))],
        ["eip155:8453:0x1"]
      )

      const later = new Date(Date.now() + 60_000)
      assert.equal(await store.useProof("siwx:a", later), true)
      assert.equal(await store.useProof("siwx:a", later), false)

      const email = "a@example.com"
      const code = {
        email,
        codeHash: "h",
        expiresAt: later,
        attempts: 0,
        sentAt: new Date(),
      }
      await store.saveCode(code)
      await store.bumpCodeAttempts(email)
      assert.equal((await store.getCode(email)).attempts, 1)
      await store.saveCode({ ...code, codeHash: "h2" })
      const saved = await store.getCode(email)
      assert.equal(saved.codeHash, "h2")
      assert.equal(saved.attempts, 0)
      await store.deleteCode(email)
      assert.equal(await store.getCode(email), null)

      const user = await store.upsertUser({ id: "u1", email })
      const again = await store.upsertUser({ id: "u2", email })
      assert.equal(again.id, user.id, "the same email keeps one account")
      assert.equal(user.autoReview, false)
      const on = await store.setAutoReview(user.id, true)
      assert.equal(on.autoReview, true)
      assert.ok(on.autoReviewAt)
      await store.insertKey("hash", user.id)
      assert.equal((await store.userForKey("hash")).email, email)
      assert.equal(await store.userForKey("nope"), null)

      await store.recordUsage({
        id: "e1",
        userId: user.id,
        kind: "check",
        task: null,
        domain: null,
        status: 200,
        client: "test",
      })
      assert.equal((await store.listUsage()).length, 1)
    } finally {
      await store?.close()
      await admin.unsafe(`drop database if exists ${database} with (force)`)
      await admin.end()
    }
  }
)
