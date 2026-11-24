import assert from "node:assert/strict"
import { test } from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { createApp } from "../server/src/index.ts"
import { validRedirectUri, verifyPkce } from "../server/src/v1/oauth.ts"
import { memoryApiReviewStore } from "../server/src/v1/store.ts"

// Signing in to the providers MCP from an app, the way Claude, Cursor, Codex
// and VS Code do it: the MCP answers 401, the app finds the sign-in endpoints,
// registers, the provider approves on app.402reviews.xyz, and the app trades
// the code for a key named after it.

const BASE = "https://reviews.test"
const json = (body, token) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  },
  body: JSON.stringify(body),
})

function setup() {
  const store = memoryApiReviewStore()
  const inbox = []
  const txt = new Map()
  const app = createApp(null, {
    v1: {
      store,
      baseUrl: BASE,
      appUrl: "https://app.reviews.test",
      secret: "test-secret-test-secret-test-secret-00",
      readTerms: async () => ({ live: true, status: 200, protocols: [], accepts: [] }),
      findPayments: async () => [],
      sendCode: async (email, code) => inbox.push({ email, code }),
      resolveTxt: async (name) => {
        if (!txt.has(name)) throw new Error("ENOTFOUND")
        return [[txt.get(name)]]
      },
    },
  })
  const appFetch = (input, init) => app.fetch(new Request(input, init))
  return { app, store, inbox, txt, appFetch }
}

async function signIn(ctx, email = "owner@example.com") {
  await ctx.app.request("/v1/merchant/start", json({ email }))
  const { code } = ctx.inbox.at(-1)
  return (await (await ctx.app.request("/v1/merchant/verify", json({ email, code }))).json()).token
}

async function verify(ctx, token, domain) {
  const claim = await (await ctx.app.request("/v1/merchant/claims", json({ domain }, token))).json()
  ctx.txt.set(claim.verification.dns.name, claim.verification.dns.value)
  await ctx.app.request(`/v1/merchant/claims/${domain}/check`, json({}, token))
}

// An app's side of OAuth, kept in memory, as the MCP SDK expects it.
function appAuth(name) {
  const saved = {}
  return {
    saved,
    redirectUrl: "http://localhost:33418/callback",
    clientMetadata: {
      client_name: name,
      redirect_uris: ["http://localhost:33418/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    clientInformation: () => saved.client,
    saveClientInformation: (info) => (saved.client = info),
    tokens: () => saved.tokens,
    saveTokens: (tokens) => (saved.tokens = tokens),
    redirectToAuthorization: (url) => (saved.authorizeUrl = url),
    saveCodeVerifier: (verifier) => (saved.verifier = verifier),
    codeVerifier: () => saved.verifier,
  }
}

// What the approval page does once the signed-in provider clicks Allow.
async function approve(ctx, session, authorizeUrl) {
  const params = Object.fromEntries(authorizeUrl.searchParams)
  const res = await ctx.app.request("/v1/merchant/oauth/approve", json(params, session))
  assert.equal(res.status, 200, await res.clone().text())
  return new URL((await res.json()).redirect)
}

test("an MCP app signs in with OAuth and gets a key named after it", async () => {
  const ctx = setup()
  const session = await signIn(ctx)
  await verify(ctx, session, "api.example.com")

  // The 401 says where to sign in.
  const bare = await ctx.appFetch(`${BASE}/mcp/providers`, json({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
  assert.equal(bare.status, 401)
  assert.match(bare.headers.get("www-authenticate"), /resource_metadata="https:\/\/reviews\.test\/\.well-known\/oauth-protected-resource\/mcp\/providers"/)

  const metadata = await (await ctx.appFetch(`${BASE}/.well-known/oauth-authorization-server`)).json()
  assert.equal(metadata.authorization_endpoint, "https://app.reviews.test/merchants/authorize")
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"])

  const auth = appAuth("Claude")
  const url = new URL(`${BASE}/mcp/providers`)
  const client = new Client({ name: "claude", version: "1.0.0" })
  await assert.rejects(
    client.connect(new StreamableHTTPClientTransport(url, { fetch: ctx.appFetch, authProvider: auth })),
    UnauthorizedError
  )
  const authorizeUrl = auth.saved.authorizeUrl
  assert.equal(authorizeUrl.origin + authorizeUrl.pathname, "https://app.reviews.test/merchants/authorize")
  assert.equal(authorizeUrl.searchParams.get("resource"), `${BASE}/mcp/providers`)

  // The approval page shows the app's name for this client and redirect.
  const preview = await ctx.app.request(
    `/v1/merchant/oauth/client?client_id=${encodeURIComponent(auth.saved.client.client_id)}&redirect_uri=${encodeURIComponent(auth.redirectUrl)}`
  )
  assert.deepEqual(await preview.json(), { name: "Claude" })

  const back = await approve(ctx, session, authorizeUrl)
  assert.equal(back.searchParams.get("state"), authorizeUrl.searchParams.get("state"))
  const transport = new StreamableHTTPClientTransport(url, { fetch: ctx.appFetch, authProvider: auth })
  await transport.finishAuth(back.searchParams.get("code"))
  assert.match(auth.saved.tokens.access_token, /^mpk_/)

  const signedIn = new Client({ name: "claude", version: "1.0.0" })
  await signedIn.connect(transport)
  const mine = JSON.parse((await signedIn.callTool({ name: "my_apis", arguments: {} })).content[0].text)
  assert.equal(mine.apis[0].domain, "api.example.com")

  // The dashboard lists it by the app's name, and revoking it signs the app out.
  const me = await (await ctx.app.request("/v1/merchant/me", { headers: { Authorization: `Bearer ${session}` } })).json()
  assert.equal(me.provider_keys.length, 1)
  assert.equal(me.provider_keys[0].name, "Claude")
  await ctx.app.request(`/v1/merchant/keys/${me.provider_keys[0].id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session}` },
  })
  const revoked = await ctx.appFetch(
    `${BASE}/mcp/providers`,
    json({ jsonrpc: "2.0", id: 1, method: "tools/list" }, auth.saved.tokens.access_token)
  )
  assert.equal(revoked.status, 401)
  assert.ok(revoked.headers.get("www-authenticate"))
})

test("a code works once, for its own app, redirect and verifier", async () => {
  const ctx = setup()
  const session = await signIn(ctx)
  const register = await ctx.appFetch(
    `${BASE}/oauth/register`,
    json({ client_name: "Cursor", redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback"] })
  )
  assert.equal(register.status, 201)
  const { client_id } = await register.json()
  const verifier = "v".repeat(43)
  const { createHash } = await import("node:crypto")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const params = {
    client_id,
    redirect_uri: "cursor://anysphere.cursor-mcp/oauth/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "s1",
  }

  // Signed out, or with a redirect the app never registered, nothing is issued.
  assert.equal((await ctx.app.request("/v1/merchant/oauth/approve", json(params))).status, 401)
  assert.equal(
    (await ctx.app.request("/v1/merchant/oauth/approve", json({ ...params, redirect_uri: "https://evil.example/cb" }, session))).status,
    400
  )
  assert.equal(
    (await ctx.app.request("/v1/merchant/oauth/approve", json({ ...params, code_challenge_method: "plain" }, session))).status,
    400
  )

  const back = await approve(ctx, session, new URL(`https://app.reviews.test/merchants/authorize?${new URLSearchParams(params)}`))
  const code = back.searchParams.get("code")
  const token = (body) =>
    ctx.appFetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })
  const exchange = { grant_type: "authorization_code", code, client_id, redirect_uri: params.redirect_uri }
  assert.equal((await token({ ...exchange, code_verifier: "w".repeat(43) })).status, 400)
  // A failed try still uses the code up.
  assert.equal((await token({ ...exchange, code_verifier: verifier })).status, 400)

  const again = await approve(ctx, session, new URL(`https://app.reviews.test/merchants/authorize?${new URLSearchParams(params)}`))
  const ok = await token({ ...exchange, code: again.searchParams.get("code"), code_verifier: verifier })
  assert.equal(ok.status, 200)
  const issued = await ok.json()
  assert.equal(issued.token_type, "Bearer")
  assert.match(issued.access_token, /^mpk_/)
  assert.equal(ok.headers.get("cache-control"), "no-store")
  assert.equal(
    (await token({ ...exchange, code: again.searchParams.get("code"), code_verifier: verifier })).status,
    400
  )
})

test("app keys don't use up hand-made keys, and the oldest app key goes past the cap", async () => {
  const ctx = setup()
  const session = await signIn(ctx)
  const { client_id } = await (
    await ctx.appFetch(`${BASE}/oauth/register`, json({ client_name: "Codex", redirect_uris: ["http://127.0.0.1:5555/cb"] }))
  ).json()
  const verifier = "x".repeat(43)
  const { createHash } = await import("node:crypto")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const connect = async () => {
    const params = { client_id, redirect_uri: "http://127.0.0.1:5555/cb", code_challenge: challenge, code_challenge_method: "S256" }
    const back = await approve(ctx, session, new URL(`https://app.reviews.test/merchants/authorize?${new URLSearchParams(params)}`))
    const res = await ctx.appFetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), client_id, redirect_uri: params.redirect_uri, code_verifier: verifier }),
    })
    return (await res.json()).access_token
  }
  const first = await connect()
  for (let i = 0; i < 10; i++) await connect()
  const keys = (await (await ctx.app.request("/v1/merchant/me", { headers: { Authorization: `Bearer ${session}` } })).json()).provider_keys
  assert.equal(keys.length, 10)
  const res = await ctx.appFetch(`${BASE}/mcp/providers`, json({ jsonrpc: "2.0", id: 1, method: "tools/list" }, first))
  assert.equal(res.status, 401)

  // Hand-made keys still have their own five.
  const made = await ctx.app.request("/v1/merchant/keys", json({}, session))
  assert.equal(made.status, 201)
  assert.equal((await made.json()).name, null)
})

test("OAuth endpoints answer browsers but stay out of the rest of the API", async () => {
  const ctx = setup()
  const meta = await ctx.appFetch(`${BASE}/.well-known/oauth-protected-resource/mcp/providers`, {
    headers: { Origin: "https://inspector.example" },
  })
  assert.equal(meta.headers.get("access-control-allow-origin"), "*")
  assert.equal((await meta.json()).resource, `${BASE}/mcp/providers`)
  const stats = await ctx.appFetch(`${BASE}/v1/stats`, { headers: { Origin: "https://inspector.example" } })
  assert.notEqual(stats.headers.get("cache-control"), "no-store")

  const bad = await ctx.appFetch(`${BASE}/oauth/register`, json({ client_name: "x", redirect_uris: ["javascript:alert(1)"] }))
  assert.equal(bad.status, 400)
  assert.equal(validRedirectUri("http://evil.example/cb"), false)
  assert.equal(validRedirectUri("http://localhost:3000/cb"), true)
  assert.equal(validRedirectUri("vscode://vscode.github-authentication/did-authenticate"), true)
  assert.equal(verifyPkce("short", "x"), false)
})
