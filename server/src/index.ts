import { serve } from "@hono/node-server"
import type { FacilitatorClient } from "@x402/core/server"
import { Hono } from "hono"
import { createPublicClient, http } from "viem"
import { z } from "zod"
import { HEDERA_TESTNET } from "../../shared/src/networks.ts"
import { loadConfig, type ServerConfig } from "./config.ts"
import { memoryStore, postgresStore } from "./db/store.ts"
import { DEMO_APIS } from "./demo-apis.ts"
import { extractInvoice } from "./invoice.ts"
import { demoApiPaywall } from "./payments.ts"
import {
  logoSvg,
  registrationFile,
  registrationPath,
  wellKnownRegistration,
} from "./registration.ts"
import { type ReviewDeps, reviewRoutes } from "./reviews.ts"

const InvoiceRequest = z.object({ text: z.string().min(1).max(20_000) })

export function createApp(
  config: ServerConfig,
  deps: {
    facilitator?: FacilitatorClient
    reviews?: Omit<ReviewDeps, "baseUrl">
  } = {}
) {
  const app = new Hono()

  app.get("/health", (c) => c.json({ ok: true }))

  app.get("/.well-known/agent-registration.json", (c) =>
    c.json(wellKnownRegistration(config))
  )

  // Unpaid requests to the demo APIs get a 402 with Hedera testnet USDC terms.
  app.use(demoApiPaywall(config, deps.facilitator))

  for (const api of DEMO_APIS) {
    app.post(api.path, async (c) => {
      const body = InvoiceRequest.safeParse(
        await c.req.json().catch(() => null)
      )
      if (!body.success) {
        return c.json({ error: 'Send JSON: {"text": "<invoice text>"}' }, 400)
      }
      return c.json(extractInvoice(body.data.text, api.mode))
    })
    app.get(registrationPath(api), (c) => c.json(registrationFile(config, api)))
    app.get(`/${api.id}/logo.svg`, (c) =>
      c.body(logoSvg(api), 200, { "Content-Type": "image/svg+xml" })
    )
  }

  if (deps.reviews) {
    app.route("/", reviewRoutes({ ...deps.reviews, baseUrl: config.baseUrl }))
  }

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = await loadConfig()
  const port = Number(process.env.PORT ?? 8787)
  const store = process.env.DATABASE_URL
    ? await postgresStore(process.env.DATABASE_URL)
    : (console.warn("DATABASE_URL is not set; reviews are kept in memory"),
      memoryStore())
  const hedera = createPublicClient({
    chain: HEDERA_TESTNET.evmChain,
    transport: http(process.env.HEDERA_RPC_URL ?? HEDERA_TESTNET.evmRpcUrl),
  })
  const app = createApp(config, {
    reviews: {
      store,
      fetch,
      mirror: { fetch },
      registry: hedera,
      receipts: hedera,
    },
  })
  serve({ fetch: app.fetch, port })
  console.log(
    `server listening on http://localhost:${port} (${config.baseUrl}), paying ${config.sellerAccountId}`
  )
}
