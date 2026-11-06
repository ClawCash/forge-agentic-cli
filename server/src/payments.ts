import {
  type FacilitatorClient,
  HTTPFacilitatorClient,
  type RoutesConfig,
  x402ResourceServer,
} from "@x402/core/server"
import type { Network } from "@x402/core/types"
import { ExactHederaScheme } from "@x402/hedera/exact/server"
import { paymentMiddleware } from "@x402/hono"
import { HEDERA_TESTNET } from "../../shared/src/networks.ts"
import type { ServerConfig } from "./config.ts"
import { DEMO_APIS } from "./demo-apis.ts"

const NETWORK = HEDERA_TESTNET.id as Network

export function demoApiRoutes(config: ServerConfig): RoutesConfig {
  return Object.fromEntries(
    DEMO_APIS.map((api) => [
      `POST ${api.path}`,
      {
        accepts: {
          scheme: "exact",
          price: api.price,
          network: NETWORK,
          payTo: config.sellerAccountId,
        },
        resource: `${config.baseUrl}${api.path}`,
        description: api.description,
        mimeType: "application/json",
        serviceName: api.name,
      },
    ])
  )
}

// Payments are USDC on Hedera testnet, verified and settled by the x402
// facilitator, which also pays the network fees (its account is advertised as
// extra.feePayer in the 402 terms).
export function demoApiPaywall(
  config: ServerConfig,
  facilitator: FacilitatorClient = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
  })
) {
  const server = new x402ResourceServer(facilitator).register(
    NETWORK,
    new ExactHederaScheme({
      defaultAssets: {
        [NETWORK]: {
          asset: HEDERA_TESTNET.usdc,
          decimals: HEDERA_TESTNET.usdcDecimals,
        },
      },
    })
  )
  return paymentMiddleware(demoApiRoutes(config), server)
}
