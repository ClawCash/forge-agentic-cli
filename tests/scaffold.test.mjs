import assert from "node:assert/strict"
import { test } from "node:test"
import { run } from "../cli/src/index.ts"
import { app } from "../server/src/index.ts"

test("cli prints usage and rejects unknown commands", () => {
  assert.equal(run(["--help"]), 0)
  assert.equal(run(["nope"]), 1)
})

test("server answers health checks", async () => {
  const res = await app.request("/health")
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})
