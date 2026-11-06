// Resolves each demo endpoint to its ERC-8004 identity the way an agent would:
// domain well-known file, then the onchain agentURI and its registration file.
//
//   npm run services:verify [-- --base-url <origin>]

import { parseArgs } from "node:util"
import { createPublicClient, http } from "viem"
import { arcTestnet } from "viem/chains"
import { DEMO_APIS } from "../server/src/demo-apis.ts"
import { resolveEndpointIdentity } from "../shared/src/identity.ts"

const { values } = parseArgs({ options: { "base-url": { type: "string" } } })
const baseUrl = (
  values["base-url"] ??
  process.env.PUBLIC_BASE_URL ??
  "https://forge-agentic-cli-production.up.railway.app"
).replace(/\/$/, "")
const registry = createPublicClient({
  chain: arcTestnet,
  transport: http(process.env.ARC_RPC_URL),
})

let failures = 0
for (const api of DEMO_APIS) {
  const endpoint = `${baseUrl}${api.path}`
  const identity = await resolveEndpointIdentity(endpoint, {
    fetch,
    registry,
  })
  if (identity.status === "verified") {
    console.log(
      `${endpoint}\n  verified: agent ${identity.agentId} "${identity.name}", owner ${identity.owner}`
    )
  } else {
    failures++
    console.log(`${endpoint}\n  unknown: ${identity.reason}`)
  }
}
process.exitCode = failures ? 1 : 0
