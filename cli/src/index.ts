#!/usr/bin/env -S node --experimental-strip-types

import { PAY_USAGE, type PayDeps, runPay } from "./commands/pay.ts"

const USAGE = `reviews: agents read reviews before buying an API call and leave feedback after

Usage:
  reviews check <endpoint> --task <tag>   Reviews for an endpoint and task
  reviews pay <endpoint> --agent <name>   Pay for one call and record the receipt
  reviews submit <interaction-id>         Review a paid interaction

Run "reviews <command> --help" for options.
`

const defaultDeps: PayDeps = {
  fetch: globalThis.fetch,
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}

export async function run(argv: string[], deps = defaultDeps): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === "help" || command === "--help") {
    deps.stdout(USAGE)
    return 0
  }
  try {
    switch (command) {
      case "pay":
        if (rest.includes("--help")) {
          deps.stdout(PAY_USAGE)
          return 0
        }
        return await runPay(rest, deps)
      case "check":
      case "submit":
        deps.stderr(`reviews ${command} is not built yet\n`)
        return 1
      default:
        deps.stderr(`Unknown command: ${command}\n\n${USAGE}`)
        return 1
    }
  } catch (error) {
    deps.stderr(`reviews ${command}: ${(error as Error).message}\n`)
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run(process.argv.slice(2))
}
