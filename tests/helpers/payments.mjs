import { x402ResourceServer } from "@x402/core/server"
import { ExactHederaScheme } from "@x402/hedera/exact/server"
import { paymentMiddleware } from "@x402/hono"
import { Hono } from "hono"

export const HEDERA = "hedera:testnet"
export const USDC = "0.0.429274"
export const FEE_PAYER = "0.0.9185802"
export const FAKE_TX = "0.0.9185802@1731000000.000000001"

// A facilitator that accepts every payment and reports FAKE_TX instead of
// touching Hedera. `settles` collects what it was asked to settle.
export function fakeFacilitator(settles = []) {
  return {
    verify: async () => ({ isValid: true }),
    settle: async (payload, requirements) => {
      settles.push({ payload, requirements })
      return {
        success: true,
        transaction: FAKE_TX,
        network: requirements.network,
      }
    },
    getSupported: async () => ({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: HEDERA,
          extra: { feePayer: FEE_PAYER },
        },
      ],
      extensions: [],
      signers: {},
    }),
  }
}

// A seller like the demo APIs, paid through fakeFacilitator.
export function fakeSeller({ payTo, price = "$0.01", settles = [] }) {
  const server = new x402ResourceServer(fakeFacilitator(settles)).register(
    HEDERA,
    new ExactHederaScheme({
      defaultAssets: { [HEDERA]: { asset: USDC, decimals: 6 } },
    })
  )
  const app = new Hono()
  app.use(
    paymentMiddleware(
      {
        "POST /paid": {
          accepts: { scheme: "exact", price, network: HEDERA, payTo },
          description: "test",
        },
      },
      server
    )
  )
  app.post("/paid", async (c) => c.json({ echo: await c.req.json() }))
  app.get("/free", (c) => c.json({ free: true }))
  return { app, fetch: (url, init) => app.request(url.toString(), init) }
}

// A Hedera mirror node that knows some accounts (EVM address → account ID)
// and transactions (ID → token transfers).
export function fakeMirror({ accounts = {}, transactions = {} } = {}) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  return {
    attempts: 1,
    delayMs: 0,
    fetch: async (url) => {
      const path = new URL(url).pathname
      const account = /^\/api\/v1\/accounts\/(.+)$/.exec(path)
      if (account) {
        const key = account[1].toLowerCase()
        const entry = Object.entries(accounts).find(
          ([address, id]) => address.toLowerCase() === key || id === account[1]
        )
        return entry
          ? json({ account: entry[1], evm_address: entry[0].toLowerCase() })
          : json({ _status: { messages: [{ message: "Not found" }] } }, 404)
      }
      const tx = /^\/api\/v1\/transactions\/(.+)$/.exec(path)
      if (tx) {
        const found = transactions[tx[1]]
        return found
          ? json({ transactions: found })
          : json({ _status: { messages: [{ message: "Not found" }] } }, 404)
      }
      return json({}, 404)
    },
  }
}

// One successful mirror node transaction moving `amount` of USDC.
export function usdcTransfer({
  from,
  to,
  amount,
  token = USDC,
  result = "SUCCESS",
}) {
  return [
    {
      result,
      consensus_timestamp: "1731000001.000000001",
      token_transfers: [
        { token_id: token, account: from, amount: -Number(amount) },
        { token_id: token, account: to, amount: Number(amount) },
      ],
    },
  ]
}
