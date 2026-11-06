import {
  HEDERA_TESTNET_IDENTITY_REGISTRY,
  HEDERA_TESTNET_REGISTRIES,
  identityRegistryAbi,
} from "./erc8004.ts"

// The verified mapping from an endpoint to its ERC-8004 identity. Both
// directions must agree:
//   1. the endpoint's domain lists the agent in /.well-known/agent-registration.json
//      (ERC-8004 endpoint domain verification), and
//   2. the agent's onchain agentURI resolves to a registration file that
//      lists this exact endpoint and the same registration.
// Anything less leaves the endpoint "unknown" rather than guessing.

export type EndpointIdentity =
  | {
      status: "verified"
      agentId: string
      agentRegistry: string
      owner: string
      name: string | null
      agentURI: string
    }
  | { status: "unknown"; reason: string }

interface RegistryReader {
  readContract(args: {
    address: `0x${string}`
    abi: typeof identityRegistryAbi
    functionName: "tokenURI" | "ownerOf"
    args: [bigint]
  }): Promise<unknown>
}

interface Registration {
  agentId: number | string
  agentRegistry: string
}

function normalize(endpoint: string) {
  const url = new URL(endpoint)
  url.hash = ""
  url.search = ""
  return url.toString().replace(/\/$/, "")
}

async function getJson(fetcher: typeof fetch, url: string) {
  const res = await fetcher(url, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

function registrationsOf(doc: Record<string, unknown>): Registration[] {
  return Array.isArray(doc.registrations)
    ? (doc.registrations as Registration[]).filter(
        (r) => r && r.agentRegistry && r.agentId !== undefined
      )
    : []
}

export async function resolveEndpointIdentity(
  endpoint: string,
  deps: { fetch: typeof fetch; registry: RegistryReader }
): Promise<EndpointIdentity> {
  const target = normalize(endpoint)
  const wellKnown = `${new URL(target).origin}/.well-known/agent-registration.json`
  let claimed: Registration[]
  try {
    claimed = registrationsOf(await getJson(deps.fetch, wellKnown)).filter(
      (r) => r.agentRegistry === HEDERA_TESTNET_IDENTITY_REGISTRY
    )
  } catch (error) {
    return { status: "unknown", reason: (error as Error).message }
  }
  if (claimed.length === 0) {
    return {
      status: "unknown",
      reason: "The domain lists no Hedera testnet ERC-8004 registration",
    }
  }

  const reasons: string[] = []
  for (const registration of claimed) {
    const agentId = BigInt(registration.agentId)
    try {
      const [agentURI, owner] = (await Promise.all([
        deps.registry.readContract({
          address: HEDERA_TESTNET_REGISTRIES.identity,
          abi: identityRegistryAbi,
          functionName: "tokenURI",
          args: [agentId],
        }),
        deps.registry.readContract({
          address: HEDERA_TESTNET_REGISTRIES.identity,
          abi: identityRegistryAbi,
          functionName: "ownerOf",
          args: [agentId],
        }),
      ])) as [string, string]
      const file = await getJson(deps.fetch, agentURI)
      const services = Array.isArray(file.services)
        ? (file.services as { endpoint?: string }[])
        : []
      const listsEndpoint = services.some(
        (s) =>
          typeof s.endpoint === "string" && normalize(s.endpoint) === target
      )
      const listsRegistration = registrationsOf(file).some(
        (r) =>
          String(r.agentId) === agentId.toString() &&
          r.agentRegistry === HEDERA_TESTNET_IDENTITY_REGISTRY
      )
      if (listsEndpoint && listsRegistration) {
        return {
          status: "verified",
          agentId: agentId.toString(),
          agentRegistry: HEDERA_TESTNET_IDENTITY_REGISTRY,
          owner,
          name: typeof file.name === "string" ? file.name : null,
          agentURI,
        }
      }
      reasons.push(
        `agent ${agentId}: its registration file does not list ${listsEndpoint ? "this registration" : "this endpoint"}`
      )
    } catch (error) {
      reasons.push(
        `agent ${agentId}: ${(error as Error).message.split("\n")[0]}`
      )
    }
  }
  return { status: "unknown", reason: reasons.join("; ") }
}
