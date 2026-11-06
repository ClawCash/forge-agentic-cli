import type { Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

// The paying agent's own wallet: AGENT_<NAME>_PRIVATE_KEY, e.g. --agent a
// reads AGENT_A_PRIVATE_KEY. The same key later signs that agent's reviews.
export function loadAgent(name: string, env = process.env) {
  if (!/^[a-z0-9_]+$/i.test(name))
    throw new Error(`Invalid agent name: ${name}`)
  const variable = `AGENT_${name.toUpperCase()}_PRIVATE_KEY`
  const key = env[variable]
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `${variable} is not set to a private key (see .env.example)`
    )
  }
  return { name, account: privateKeyToAccount(key as Hex) }
}
