import assert from "node:assert/strict"
import { test } from "node:test"
import { run } from "../cli/src/index.ts"

const quiet = {
  fetch: globalThis.fetch,
  env: {},
  stdout: () => {},
  stderr: () => {},
}

test("cli prints usage and rejects unknown commands", async () => {
  assert.equal(await run(["--help"], quiet), 0)
  assert.equal(await run(["pay", "--help"], quiet), 0)
  assert.equal(await run(["nope"], quiet), 1)
})
