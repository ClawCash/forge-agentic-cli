import assert from "node:assert/strict"
import { test } from "node:test"
import { setEnvValue } from "../scripts/new-wallet.ts"

test("fills an empty entry copied from .env.example", () => {
  const content = "ARC_RPC_URL=x\nAGENT_A_PRIVATE_KEY=\nPORT=1\n"
  assert.equal(
    setEnvValue(content, "AGENT_A_PRIVATE_KEY", "0xabc"),
    "ARC_RPC_URL=x\nAGENT_A_PRIVATE_KEY=0xabc\nPORT=1\n"
  )
})

test("appends a missing entry", () => {
  assert.equal(
    setEnvValue("", "AGENT_B_PRIVATE_KEY", "0x1"),
    "AGENT_B_PRIVATE_KEY=0x1\n"
  )
  assert.equal(setEnvValue("A=1", "B", "2"), "A=1\nB=2\n")
})

test("never overwrites an existing key", () => {
  assert.throws(
    () =>
      setEnvValue(
        "AGENT_A_PRIVATE_KEY=0xold\n",
        "AGENT_A_PRIVATE_KEY",
        "0xnew"
      ),
    /already set/
  )
})

test("rejects odd variable names", () => {
  assert.throws(
    () => setEnvValue("", "bad name", "0x1"),
    /Invalid variable name/
  )
})
