// Registers the two demo services on the ERC-8004 identity registry (Hedera
// testnet) from the service owner's wallet. Each agentURI points to the
// service's registration file on the deployed server.
//
//   npm run services:register                 register what isn't registered yet
//   npm run services:register -- --save       also write the agent IDs into .env
//
// Already-registered services (DEMO_API_<X>_AGENT_ID set) are checked and left
// alone; if their agentURI changed, pass --update to point them at the new one.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import {
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseEventLogs,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  HEDERA_TESTNET_REGISTRIES,
  identityRegistryAbi,
} from "../shared/src/erc8004.ts"
import { DEMO_APIS } from "../server/src/demo-apis.ts"
import { registrationPath } from "../server/src/registration.ts"
import { HEDERA_TESTNET } from "../shared/src/networks.ts"
import { setEnvValue } from "./new-wallet.ts"

const DEFAULT_BASE_URL = "https://reviews-api.forgeintel.co"
const explorerTx = (hash: string) =>
  `https://hashscan.io/testnet/transaction/${hash}`

async function main() {
  const { values } = parseArgs({
    options: {
      "base-url": { type: "string" },
      save: { type: "boolean", default: false },
      update: { type: "boolean", default: false },
      "env-file": { type: "string", default: ".env" },
    },
  })
  const key = process.env.SERVICE_OWNER_PRIVATE_KEY
  if (!key) throw new Error("SERVICE_OWNER_PRIVATE_KEY is not set")
  const baseUrl = (
    values["base-url"] ??
    process.env.PUBLIC_BASE_URL ??
    DEFAULT_BASE_URL
  ).replace(/\/$/, "")
  const account = privateKeyToAccount(key as Hex)
  const chain = HEDERA_TESTNET.evmChain
  const transport = http(process.env.HEDERA_RPC_URL ?? HEDERA_TESTNET.evmRpcUrl)
  const reader = createPublicClient({ chain, transport })
  const wallet = createWalletClient({ account, chain, transport })
  const registry = HEDERA_TESTNET_REGISTRIES.identity

  console.log(`Owner ${account.address}, registry ${registry} (Hedera testnet)`)
  const ids: Record<string, string> = {}

  for (const api of DEMO_APIS) {
    const variable = `DEMO_API_${api.id.toUpperCase()}_AGENT_ID`
    const agentURI = `${baseUrl}${registrationPath(api)}`
    const existing = process.env[variable]

    if (existing) {
      const agentId = BigInt(existing)
      const [owner, currentURI] = await Promise.all([
        reader.readContract({
          address: registry,
          abi: identityRegistryAbi,
          functionName: "ownerOf",
          args: [agentId],
        }),
        reader.readContract({
          address: registry,
          abi: identityRegistryAbi,
          functionName: "tokenURI",
          args: [agentId],
        }),
      ])
      if (owner.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error(`${variable}=${existing} is owned by ${owner}, not you`)
      }
      if (currentURI === agentURI) {
        console.log(`${api.name}: already registered as agent ${existing}`)
      } else if (values.update) {
        const hash = await wallet.writeContract({
          address: registry,
          abi: identityRegistryAbi,
          functionName: "setAgentURI",
          args: [agentId, agentURI],
        })
        await reader.waitForTransactionReceipt({ hash })
        console.log(`${api.name}: agent ${existing} now points to ${agentURI}`)
        console.log(`  ${explorerTx(hash)}`)
      } else {
        console.log(
          `${api.name}: agent ${existing} points to ${currentURI}; pass --update to change it`
        )
      }
      ids[variable] = existing
      continue
    }

    const hash = await wallet.writeContract({
      address: registry,
      abi: identityRegistryAbi,
      functionName: "register",
      args: [agentURI],
    })
    const receipt = await reader.waitForTransactionReceipt({ hash })
    if (receipt.status !== "success") {
      throw new Error(`Registering ${api.name} reverted: ${explorerTx(hash)}`)
    }
    const [registered] = parseEventLogs({
      abi: identityRegistryAbi,
      eventName: "Registered",
      logs: receipt.logs,
    })
    if (!registered) throw new Error(`No Registered event in ${hash}`)
    const agentId = registered.args.agentId.toString()
    ids[variable] = agentId
    console.log(`${api.name}: registered as agent ${agentId} → ${agentURI}`)
    console.log(`  ${explorerTx(hash)}`)
  }

  console.log("")
  for (const [variable, id] of Object.entries(ids)) {
    console.log(`${variable}=${id}`)
  }
  if (values.save) {
    const file = values["env-file"]
    let content = existsSync(file) ? readFileSync(file, "utf8") : ""
    for (const [variable, id] of Object.entries(ids)) {
      if (process.env[variable] === id) continue
      content = setEnvValue(content, variable, id)
    }
    writeFileSync(file, content)
    console.log(`Saved to ${file}`)
  }
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
