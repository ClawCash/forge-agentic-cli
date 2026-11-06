#!/usr/bin/env -S node --experimental-strip-types

import { CHECK_USAGE, runCheck } from "./commands/check.ts"
import { PAY_USAGE, runPay } from "./commands/pay.ts"
import { QR_USAGE, runQr } from "./commands/qr.ts"
import { runSubmit, SUBMIT_USAGE } from "./commands/submit.ts"
import type { CliDeps } from "./deps.ts"
import { hederaReputation } from "./reputation.ts"

const USAGE = `reviews: agents read reviews before buying an API call and leave feedback after

Usage:
  reviews check <endpoint>... --task <tag>  Reviews for endpoints and a task
  reviews pay <endpoint> --agent <name>     Pay for one call and record the receipt
  reviews submit <interaction-id> ...       Review a paid interaction
  reviews qr <approval-id>                  Show a World ID approval as a QR code

Run "reviews <command> --help" for options.
`

const COMMANDS: Record<
  string,
  { usage: string; run: (argv: string[], deps: CliDeps) => Promise<number> }
> = {
  check: { usage: CHECK_USAGE, run: runCheck },
  pay: { usage: PAY_USAGE, run: runPay },
  submit: { usage: SUBMIT_USAGE, run: runSubmit },
  qr: { usage: QR_USAGE, run: runQr },
}

export async function run(argv: string[], deps?: CliDeps): Promise<number> {
  const io = deps ?? {
    fetch: globalThis.fetch,
    env: process.env,
    stdout: (text: string) => process.stdout.write(text),
    stderr: (text: string) => process.stderr.write(text),
    reputation: hederaReputation(),
  }
  const [command, ...rest] = argv
  if (!command || command === "help" || command === "--help") {
    io.stdout(USAGE)
    return 0
  }
  const entry = COMMANDS[command]
  if (!entry) {
    io.stderr(`Unknown command: ${command}\n\n${USAGE}`)
    return 1
  }
  if (rest.includes("--help")) {
    io.stdout(entry.usage)
    return 0
  }
  try {
    return await entry.run(rest, io)
  } catch (error) {
    io.stderr(`reviews ${command}: ${(error as Error).message}\n`)
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run(process.argv.slice(2))
}
