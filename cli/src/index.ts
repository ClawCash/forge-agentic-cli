#!/usr/bin/env -S node --experimental-strip-types

const USAGE = `reviews: agents read reviews before buying an API call and leave feedback after

Usage:
  reviews check <endpoint> --task <tag>   Reviews for an endpoint and task
  reviews pay <endpoint>                  Pay for one call and record the receipt
  reviews submit <interaction-id>         Review a paid interaction
`

const COMMANDS = new Set(["check", "pay", "submit"])

export function run(argv: string[]): number {
  const [command] = argv
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(USAGE)
    return 0
  }
  if (!COMMANDS.has(command)) {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`)
    return 1
  }
  process.stderr.write(`reviews ${command} is not built yet\n`)
  return 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = run(process.argv.slice(2))
}
