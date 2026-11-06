import type { RoutesConfig } from "@x402/core/server"
import { x402Facilitator } from "@x402/core/facilitator"
import { type FacilitatorClient, x402ResourceServer } from "@x402/core/server"
import type { Network, SupportedResponse } from "@x402/core/types"
import { toFacilitatorEvmSigner } from "@x402/evm"
import { registerExactEvmScheme as registerExactFacilitator } from "@x402/evm/exact/facilitator"
import { ExactEvmScheme } from "@x402/evm/exact/server"
import { paymentMiddleware } from "@x402/hono"
import { createWalletClient, http, publicActions } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { arcTestnet } from "viem/chains"
import type { ServerConfig } from "./config.ts"
import { DEMO_APIS } from "./demo-apis.ts"

export const ARC_TESTNET: Network = "eip155:5042002"

// No public facilitator supports Arc testnet, so the server settles its own
// payments: it verifies the buyer's signed EIP-3009 USDC authorization and
// submits it onchain, which gives one transaction hash per paid call.
function localArcFacilitator(config: ServerConfig): FacilitatorClient {
  const account = privateKeyToAccount(config.sellerPrivateKey)
  const wallet = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(config.arcRpcUrl),
  }).extend(publicActions)
  const signer = toFacilitatorEvmSigner({
    address: account.address,
    readContract: (args) => wallet.readContract(args as never),
    verifyTypedData: (args) => wallet.verifyTypedData(args as never),
    writeContract: (args) => wallet.writeContract(args as never),
    sendTransaction: (args) => wallet.sendTransaction(args),
    waitForTransactionReceipt: (args) => wallet.waitForTransactionReceipt(args),
    getCode: (args) => wallet.getCode(args),
  })
  const facilitator = registerExactFacilitator(new x402Facilitator(), {
    signer,
    networks: ARC_TESTNET,
  })
  return {
    verify: (payload, requirements) =>
      facilitator.verify(payload, requirements),
    settle: (payload, requirements) =>
      facilitator.settle(payload, requirements),
    // The facilitator types network as a plain string; its values are the
    // registered CAIP-2 networks.
    getSupported: async () => facilitator.getSupported() as SupportedResponse,
  }
}

export function demoApiRoutes(config: ServerConfig): RoutesConfig {
  const payTo = privateKeyToAccount(config.sellerPrivateKey).address
  return Object.fromEntries(
    DEMO_APIS.map((api) => [
      `POST ${api.path}`,
      {
        accepts: {
          scheme: "exact",
          price: api.price,
          network: ARC_TESTNET,
          payTo,
        },
        resource: `${config.baseUrl}${api.path}`,
        description: api.description,
        mimeType: "application/json",
        serviceName: api.name,
      },
    ])
  )
}

export function demoApiPaywall(config: ServerConfig) {
  const server = new x402ResourceServer(localArcFacilitator(config)).register(
    ARC_TESTNET,
    new ExactEvmScheme()
  )
  return paymentMiddleware(demoApiRoutes(config), server)
}
