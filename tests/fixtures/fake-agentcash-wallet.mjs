// A stand-in wallet MCP server for the wrapper's tests. It answers `search`
// with FAKE_SEARCH, `broken` with an error result, and anything else by
// echoing back the exact line it received, with unusual spacing so a test can
// tell whether the wrapper rewrote the answer.
import { createInterface } from "node:readline"

const say = (line) => process.stdout.write(`${line}\n`)

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line)
  if (message.method === "quit") process.exit(3)
  if (message.id === undefined) return
  const id = JSON.stringify(message.id)
  const text = JSON.stringify(process.env.FAKE_SEARCH ?? "")
  const tool = message.params?.name
  if (message.method === "tools/call" && tool === "search") {
    say(`{"jsonrpc":"2.0","id":${id},"result":{"content":[{"type":"text","text":${text}}]}}`)
  } else if (message.method === "tools/call" && tool === "broken") {
    say(`{"jsonrpc":"2.0","id":${id},"result":{"isError":true,"content":[{"type":"text","text":${text}}]}}`)
  } else {
    say(`{"jsonrpc":"2.0",  "id":${id},  "result":{"echo":${JSON.stringify(line)}}}`)
  }
})
