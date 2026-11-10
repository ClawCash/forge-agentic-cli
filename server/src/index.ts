import { randomBytes } from "node:crypto"
import { serve } from "@hono/node-server"
import type { FacilitatorClient } from "@x402/core/server"
import { Hono } from "hono"
import { createPublicClient, http } from "viem"
import { z } from "zod"
import { HEDERA_TESTNET } from "../../shared/src/networks.ts"
import { approvalRoutes } from "./approvals.ts"
import { loadConfig, publicBaseUrl, type ServerConfig } from "./config.ts"
import { memoryStore, postgresStore } from "./db/store.ts"
import { resendSender } from "./v1/accounts.ts"
import { chainFinder } from "./v1/chains.ts"
import { mcpRoutes } from "./v1/mcp.ts"
import { type V1Deps, v1Routes } from "./v1/routes.ts"
import { memoryApiReviewStore, postgresApiReviewStore } from "./v1/store.ts"
import { healthChecker, listingFinder } from "./v1/health.ts"
import { profileReader } from "./v1/profiles.ts"
import { advertisedReader, termsReader } from "./v1/terms.ts"
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
import { type WorldSignIn, worldSignIn } from "./world.ts"

const InvoiceRequest = z.object({ text: z.string().min(1).max(20_000) })

// `config` is null when the Hedera demo isn't configured; the /v1 API needs
// none of it.
export function createApp(
  config: ServerConfig | null,
  deps: {
    facilitator?: FacilitatorClient
    reviews?: Omit<ReviewDeps, "baseUrl">
    world?: WorldSignIn | null
    approvalTtlMs?: number
    v1?: V1Deps
  } = {}
) {
  const app = new Hono()

  app.get("/health", (c) => c.json({ ok: true }))

  if (deps.v1) {
    app.route("/v1", v1Routes(deps.v1))
    app.route(
      "/mcp",
      mcpRoutes({
        baseUrl: deps.v1.baseUrl,
        call: (path, init) => app.request(path, init),
      })
    )
  }
  if (!config) return app

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
    app.route(
      "/",
      approvalRoutes({
        store: deps.reviews.store,
        baseUrl: config.baseUrl,
        world: deps.world ?? null,
        ttlMs: deps.approvalTtlMs,
      })
    )
    app.route("/", reviewRoutes({ ...deps.reviews, baseUrl: config.baseUrl }))
  }

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  const config =
    env.SERVICE_OWNER_HEDERA_ACCOUNT_ID || env.SERVICE_OWNER_PRIVATE_KEY
      ? await loadConfig()
      : null
  const port = Number(env.PORT ?? 8787)
  const store = env.DATABASE_URL
    ? await postgresStore(env.DATABASE_URL)
    : (console.warn("DATABASE_URL is not set; reviews are kept in memory"),
      memoryStore())
  const v1: V1Deps = {
    store: env.DATABASE_URL
      ? await postgresApiReviewStore(env.DATABASE_URL)
      : memoryApiReviewStore(),
    baseUrl: publicBaseUrl(env),
    // Only signs short-lived challenges, so a restart costs at most a retry.
    secret: env.REVIEWS_SECRET ?? randomBytes(32).toString("base64"),
    baseRpcUrl: env.BASE_RPC_URL,
    findPayments: chainFinder(env),
    sendCode: resendSender(env),
    readTerms: termsReader(undefined, undefined, {
      listings: listingFinder(),
    }),
    readAdvertised: advertisedReader(),
    readProfile: profileReader(),
  }
  const hedera = createPublicClient({
    chain: HEDERA_TESTNET.evmChain,
    transport: http(process.env.HEDERA_RPC_URL ?? HEDERA_TESTNET.evmRpcUrl),
  })
  const world =
    process.env.WORLD_CLIENT_ID && process.env.WORLD_CLIENT_SECRET
      ? worldSignIn({
          issuer: process.env.WORLD_ISSUER ?? "https://auth.world.org",
          clientId: process.env.WORLD_CLIENT_ID,
          clientSecret: process.env.WORLD_CLIENT_SECRET,
          redirectUri: `${v1.baseUrl}/approvals/callback`,
        })
      : (console.warn("WORLD_CLIENT_ID is not set; human approvals are off"),
        null)
  const app = createApp(config, {
    v1,
    world,
    reviews: {
      store,
      fetch,
      mirror: { fetch },
      registry: hedera,
      receipts: hedera,
      allowRepeatHumanReviews:
        process.env.ALLOW_REPEAT_HUMAN_REVIEWS === "true",
    },
  })
  healthChecker({
    store: v1.store,
    readTerms: termsReader(undefined, undefined, { specs: false }),
  }).start()
  serve({ fetch: app.fetch, port })
  console.log(`server listening on http://localhost:${port} (${v1.baseUrl})`)
}
