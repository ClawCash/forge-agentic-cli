import assert from "node:assert/strict"
import { test } from "node:test"
import { run } from "../cli/src/index.ts"

test("cli prints usage and rejects unknown commands", () => {
  assert.equal(run(["--help"]), 0)
  assert.equal(run(["nope"]), 1)
})
