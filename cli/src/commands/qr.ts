import { parseArgs } from "node:util"
import { qrFor, waitFor } from "../approval.ts"
import type { CliDeps } from "../deps.ts"
import { DEFAULT_SERVER } from "./submit.ts"

export const QR_USAGE = `Usage: reviews qr <approval-id> [options]

Shows a World ID approval page as a QR code, for a person to scan with the
phone that has World App, and waits until they approve or deny. Agents run it
in the person's terminal after "reviews submit --no-wait".

Options:
  --server <url>   Reviews server (default: REVIEWS_SERVER or the demo server)
  --no-wait        Show the QR code and exit
`

const APPROVAL_ID = /^apr_[0-9a-f-]{36}$/

export async function runQr(argv: string[], deps: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      server: { type: "string" },
      "no-wait": { type: "boolean", default: false },
    },
  })
  // Accept the id or the approval link itself.
  const id = /(apr_[0-9a-f-]{36})\/?$/.exec(positionals[0] ?? "")?.[1]
  if (!id || !APPROVAL_ID.test(id)) {
    deps.stderr(`An approval id (apr_…) is required.\n\n${QR_USAGE}`)
    return 1
  }
  const server = (
    values.server ??
    deps.env.REVIEWS_SERVER ??
    DEFAULT_SERVER
  ).replace(/\/$/, "")
  const url = `${server}/approvals/${id}`

  deps.stdout(
    `\nScan with your phone and approve with World ID:\n\n${qrFor(url)}${url}\n`
  )
  if (values["no-wait"]) return 0

  deps.stdout("\nWaiting for approval…\n")
  const result = await waitFor(id, `${url}/status`, deps)
  if (result.status === "approved") {
    deps.stdout(
      "Approved with World ID. Tell your agent to finish the review.\n"
    )
    return 0
  }
  deps.stdout(
    `Not approved (${result.status}${result.reason ? `: ${result.reason}` : ""}).\n`
  )
  return 1
}
