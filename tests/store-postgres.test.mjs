import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import postgres from "postgres"
import { DuplicateReviewError, postgresStore } from "../server/src/db/store.ts"

// Runs against a real database only when one is provided, e.g.
// REVIEWS_TEST_DATABASE_URL=postgres://localhost:55432/postgres npm test
// (the user needs permission to create databases).
const url = process.env.REVIEWS_TEST_DATABASE_URL

test(
  "the Postgres store migrates, stores, dedupes and publishes",
  { skip: !url },
  async () => {
    // A throwaway database per run: drizzle keeps its migration journal in a
    // shared schema, so schemas alone would not isolate runs.
    const database = `reviews_test_${randomUUID().replaceAll("-", "")}`
    const admin = postgres(url, { max: 1, onnotice: () => {} })
    await admin.unsafe(`create database ${database}`)
    const scopedUrl = new URL(url)
    scopedUrl.pathname = `/${database}`
    let store
    try {
      store = await postgresStore(scopedUrl.toString())
      const base = {
        agentRegistry: "eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e",
        agentId: "169",
        endpoint: "https://demo.example/a/invoices/extract",
        task: "invoice-extraction:hi",
        outcome: "failure",
        value: 0,
        reviewer: "0x6c259ee820b03a8a48209E66f16CC3fD399d9a96",
        document: "{}",
        documentHash: `0x${"00".repeat(32)}`,
      }
      const row = await store.insert({
        ...base,
        id: "rev_1",
        paymentTransaction: "tx-1",
      })
      assert.equal(row.status, "pending")
      await assert.rejects(
        store.insert({ ...base, id: "rev_2", paymentTransaction: "tx-1" }),
        DuplicateReviewError
      )
      await store.insert({
        ...base,
        id: "rev_3",
        paymentTransaction: "tx-3",
        task: "other",
      })
      const published = await store.markPublished("rev_1", {
        feedbackTransaction: `0x${"ab".repeat(32)}`,
        feedbackIndex: "1",
      })
      assert.equal(published.status, "published")
      assert.ok(published.publishedAt instanceof Date)
      assert.equal((await store.get("rev_1")).feedbackIndex, "1")
      assert.deepEqual(
        (
          await store.list({ agentId: "169", task: "invoice-extraction:hi" })
        ).map((r) => r.id),
        ["rev_1"]
      )
      assert.equal((await store.list({ agentId: "169" })).length, 2)
      assert.equal(await store.get("missing"), null)
    } finally {
      await store?.close()
      await admin.unsafe(`drop database ${database} with (force)`)
      await admin.end()
    }
  }
)
