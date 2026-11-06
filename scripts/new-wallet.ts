// Generates a throwaway ECDSA wallet for Hedera testnet. Never fund it
// with real money.
//
//   npm run wallet:new                              print address and private key
//   npm run wallet:new -- --save AGENT_A_PRIVATE_KEY  write the key to .env, print only the address

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/

// Sets name=value in .env content. An empty existing entry (as copied from
// .env.example) is filled in; a non-empty one is never overwritten.
export function setEnvValue(content: string, name: string, value: string) {
  if (!ENV_NAME.test(name)) throw new Error(`Invalid variable name: ${name}`)
  const lines = content.split("\n")
  const index = lines.findIndex((line) => line.startsWith(`${name}=`))
  if (index === -1) {
    const body =
      content === "" || content.endsWith("\n") ? content : `${content}\n`
    return `${body}${name}=${value}\n`
  }
  if (lines[index].slice(name.length + 1).trim() !== "") {
    throw new Error(`${name} is already set; clear it first to replace it`)
  }
  lines[index] = `${name}=${value}`
  return lines.join("\n")
}

function main() {
  const { values } = parseArgs({
    options: {
      save: { type: "string" },
      "env-file": { type: "string", default: ".env" },
    },
  })
  const privateKey = generatePrivateKey()
  const { address } = privateKeyToAccount(privateKey)

  if (values.save) {
    const file = values["env-file"]
    const content = existsSync(file) ? readFileSync(file, "utf8") : ""
    writeFileSync(file, setEnvValue(content, values.save, privateKey))
    // The file holds private keys, so keep it readable by the owner only.
    chmodSync(file, 0o600)
    console.log(`Address: ${address}`)
    console.log(`Saved the private key to ${file} as ${values.save}`)
  } else {
    console.log(`Address:     ${address}`)
    console.log(`Private key: ${privateKey}`)
    console.log("Testnet only. Anyone with this key controls the wallet.")
  }
  console.log(
    "Fund on Hedera testnet: HBAR at https://portal.hedera.com/faucet, then USDC at https://faucet.circle.com (Hedera Testnet)"
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main()
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
