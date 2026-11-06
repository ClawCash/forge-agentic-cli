import { x402ResourceServer } from "@x402/core/server"
import { ExactEvmScheme } from "@x402/evm/exact/server"
import { paymentMiddleware } from "@x402/hono"
import { Hono } from "hono"
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from "viem"

export const ARC = "eip155:5042002"
export const USDC = "0x3600000000000000000000000000000000000000"
export const FAKE_TX = `0x${"ab".repeat(32)}`

// A seller like the demo APIs, but its facilitator accepts every payment and
// reports FAKE_TX instead of touching a chain.
export function fakeSeller({ payTo, price = "$0.01", settles = [] }) {
  const facilitator = {
    verify: async (payload) => ({
      isValid: true,
      payer: payload.payload.authorization.from,
    }),
    settle: async (payload, requirements) => {
      settles.push({ payload, requirements })
      return {
        success: true,
        transaction: FAKE_TX,
        network: requirements.network,
        payer: payload.payload.authorization.from,
      }
    },
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: ARC }],
      extensions: [],
      signers: {},
    }),
  }
  const server = new x402ResourceServer(facilitator).register(
    ARC,
    new ExactEvmScheme()
  )
  const app = new Hono()
  app.use(
    paymentMiddleware(
      {
        "POST /paid": {
          accepts: { scheme: "exact", price, network: ARC, payTo },
          description: "test",
        },
      },
      server
    )
  )
  app.post("/paid", async (c) => c.json({ echo: await c.req.json() }))
  app.get("/free", (c) => c.json({ free: true }))
  return {
    app,
    fetch: (url, init) => app.request(url.toString(), init),
  }
}

// A receipt reader that returns one successful transaction with the given
// USDC transfer.
export function fakeReceipts({
  from,
  to,
  value,
  asset = USDC,
  status = "success",
}) {
  const topics = encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: { from, to },
  })
  return {
    getTransactionReceipt: async () => ({
      status,
      blockNumber: 123n,
      logs: [
        {
          address: asset,
          topics,
          data: encodeAbiParameters([{ type: "uint256" }], [value]),
          blockNumber: 123n,
          transactionHash: FAKE_TX,
          logIndex: 0,
          blockHash: `0x${"cd".repeat(32)}`,
          transactionIndex: 0,
          removed: false,
        },
      ],
    }),
  }
}
