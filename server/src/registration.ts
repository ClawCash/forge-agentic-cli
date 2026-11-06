import type { ServerConfig } from "./config.ts"
import { DEMO_APIS, type DemoApi } from "./demo-apis.ts"

// ERC-8004 identity registry on Arc testnet.
// https://docs.arc.io/arc/references/contract-addresses#erc-8004
export const ARC_TESTNET_IDENTITY_REGISTRY =
  "eip155:5042002:0x8004A818BFB912233c491871b3d84c89A494BD9e"

function registrations(config: ServerConfig, api: DemoApi) {
  const agentId = config.agentIds[api.id]
  return agentId
    ? [
        {
          agentId: Number(agentId),
          agentRegistry: ARC_TESTNET_IDENTITY_REGISTRY,
        },
      ]
    : []
}

export function registrationPath(api: DemoApi) {
  return `/${api.id}/agent-registration.json`
}

// The file each service's ERC-8004 agentURI points to.
// https://eips.ethereum.org/EIPS/eip-8004#identity-registry
export function registrationFile(config: ServerConfig, api: DemoApi) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: api.name,
    description: api.description,
    image: `${config.baseUrl}/${api.id}/logo.svg`,
    services: [{ name: "web", endpoint: `${config.baseUrl}${api.path}` }],
    x402Support: true,
    active: true,
    registrations: registrations(config, api),
    supportedTrust: ["reputation"],
  }
}

// Endpoint domain verification: both services live on this domain, so the
// well-known file lists both registrations.
export function wellKnownRegistration(config: ServerConfig) {
  return {
    registrations: DEMO_APIS.flatMap((api) => registrations(config, api)),
  }
}

export function logoSvg(api: DemoApi) {
  const color = api.id === "a" ? "#2563eb" : "#16a34a"
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="43" font-family="sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${api.id.toUpperCase()}</text></svg>`
}
