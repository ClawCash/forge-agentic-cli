import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { cors } from "hono/cors"
import { hashKey } from "./accounts.ts"
import { clientIp, rateLimiter } from "./limits.ts"
import type { ApiReviewStore } from "./store.ts"

// Signing in to the providers MCP from an app. Claude, Cursor, Codex and VS
// Code find these endpoints on their own when the MCP answers 401: the app
// registers itself, sends the provider to app.402reviews.xyz to approve, and
// trades the one-time code for a provider key. The key carries the app's name,
// shows on the dashboard and can be revoked like any other.

export const PROVIDER_MCP_PATH = "/mcp/providers"
export const PROVIDER_SCOPE = "providers:read"
export const DEFAULT_APP_URL = "https://app.402reviews.xyz"
const CODE_MS = 10 * 60_000
// Signing in again from another app or machine adds a key; past this many,
// the oldest one made by signing in is revoked.
export const MAX_CONNECTED_APPS = 10

export class OauthError extends Error {
  readonly status: 400 | 401 | 403
  readonly code: string
  constructor(status: 400 | 401 | 403, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const resourceUrl = (apiBase: string) => `${apiBase}${PROVIDER_MCP_PATH}`

export function protectedResource(apiBase: string) {
  return {
    resource: resourceUrl(apiBase),
    resource_name: "402reviews for API providers",
    authorization_servers: [apiBase],
    bearer_methods_supported: ["header"],
    scopes_supported: [PROVIDER_SCOPE],
  }
}

export function authorizationServer(apiBase: string, appBase: string) {
  return {
    issuer: apiBase,
    authorization_endpoint: `${appBase}/merchants/authorize`,
    token_endpoint: `${apiBase}/oauth/token`,
    registration_endpoint: `${apiBase}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [PROVIDER_SCOPE],
  }
}

// What the MCP sends with a 401, so the app knows where to sign in.
export const wwwAuthenticate = (apiBase: string) =>
  `Bearer resource_metadata="${apiBase}/.well-known/oauth-protected-resource${PROVIDER_MCP_PATH}", scope="${PROVIDER_SCOPE}"`

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:", "vbscript:"])

// Apps send people back to https pages, to localhost while a CLI waits, or to
// their own scheme (cursor://, vscode://).
export function validRedirectUri(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (BLOCKED_SCHEMES.has(url.protocol) || url.username || url.password) return false
  if (url.hash) return false
  if (url.protocol === "https:") return true
  if (url.protocol === "http:") {
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  }
  return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol)
}

export function verifyPkce(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"))
  const expected = Buffer.from(challenge)
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}

// A resource the app may name: this MCP's URL, with or without a trailing slash.
function rightResource(apiBase: string, resource: string | null | undefined) {
  if (!resource) return true
  return resource.replace(/\/$/, "") === resourceUrl(apiBase)
}

// The app's name and whether this redirect is one it registered, for the
// approval page. Null when either is wrong, so nobody is sent anywhere.
export async function clientFor(
  store: ApiReviewStore,
  clientId: string,
  redirectUri: string
) {
  const client = clientId ? await store.oauthClient(clientId) : null
  if (!client || !client.redirectUris.includes(redirectUri)) return null
  return { name: client.name }
}

// A signed-in provider approved the app: a one-time code goes back to it.
export async function approveGrant(
  store: ApiReviewStore,
  apiBase: string,
  input: {
    email: string
    clientId: string
    redirectUri: string
    codeChallenge: string
    codeChallengeMethod: string
    state: string | null
    resource: string | null
  },
  now = new Date()
) {
  if (!(await clientFor(store, input.clientId, input.redirectUri))) {
    throw new OauthError(400, "invalid_request", "This app or its redirect isn't registered.")
  }
  if (
    input.codeChallengeMethod !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)
  ) {
    throw new OauthError(400, "invalid_request", "The app must use PKCE with S256.")
  }
  if (!rightResource(apiBase, input.resource)) {
    throw new OauthError(400, "invalid_target", "That isn't this MCP.")
  }
  const code = randomBytes(32).toString("base64url")
  await store.saveOauthCode({
    codeHash: hashKey(code),
    clientId: input.clientId,
    email: input.email,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    expiresAt: new Date(now.getTime() + CODE_MS),
  })
  const target = new URL(input.redirectUri)
  target.searchParams.set("code", code)
  if (input.state) target.searchParams.set("state", input.state)
  target.searchParams.set("iss", apiBase)
  return target.toString()
}

// The app trades its code for a provider key named after it.
export async function exchangeCode(
  store: ApiReviewStore,
  apiBase: string,
  body: URLSearchParams
) {
  if (body.get("grant_type") !== "authorization_code") {
    throw new OauthError(400, "unsupported_grant_type", "Only authorization_code is supported.")
  }
  const code = body.get("code") ?? ""
  const row = code ? await store.useOauthCode(hashKey(code)) : null
  if (
    !row ||
    row.clientId !== (body.get("client_id") ?? "") ||
    row.redirectUri !== (body.get("redirect_uri") ?? "") ||
    !verifyPkce(body.get("code_verifier") ?? "", row.codeChallenge)
  ) {
    throw new OauthError(400, "invalid_grant", "This code is invalid, used or expired.")
  }
  if (!rightResource(apiBase, body.get("resource"))) {
    throw new OauthError(400, "invalid_target", "That isn't this MCP.")
  }
  const client = await store.oauthClient(row.clientId)
  const connected = (await store.providerKeys(row.email)).filter((key) => key.name)
  for (const old of connected.slice(MAX_CONNECTED_APPS - 1)) {
    await store.revokeProviderKey(old.id, row.email)
  }
  const key = `mpk_${randomBytes(32).toString("base64url")}`
  await store.insertProviderKey({
    id: randomUUID(),
    email: row.email,
    keyHash: hashKey(key),
    prefix: key.slice(0, 12),
    name: client?.name ?? "MCP app",
  })
  return { access_token: key, token_type: "Bearer", scope: PROVIDER_SCOPE }
}

export async function registerClient(store: ApiReviewStore, body: unknown) {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {}
  const redirects = Array.isArray(record.redirect_uris)
    ? record.redirect_uris.filter((uri): uri is string => typeof uri === "string")
    : []
  if (!redirects.length || redirects.length > 10 || redirects.some((uri) => uri.length > 2000)) {
    throw new OauthError(400, "invalid_client_metadata", "Send 1 to 10 redirect_uris.")
  }
  if (!redirects.every(validRedirectUri)) {
    throw new OauthError(400, "invalid_redirect_uri", "A redirect URI isn't allowed.")
  }
  const raw = typeof record.client_name === "string" ? record.client_name : ""
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) || "MCP app"
  const id = `oc_${randomBytes(18).toString("base64url")}`
  await store.saveOauthClient({ id, name, redirectUris: redirects })
  return {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: redirects,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }
}

function errorResponse(error: unknown) {
  const headers = { "Cache-Control": "no-store" }
  if (error instanceof OauthError) {
    return Response.json(
      { error: error.code, error_description: error.message },
      { status: error.status, headers }
    )
  }
  console.error("OAuth request failed", error)
  return Response.json(
    { error: "server_error", error_description: "Something went wrong. Try again." },
    { status: 500, headers }
  )
}

export function oauthRoutes(deps: {
  store: ApiReviewStore
  apiBase: string
  appBase: string
}) {
  const app = new Hono()
  const hit = rateLimiter()
  const limited = (header: (name: string) => string | undefined, kind: string) =>
    !hit(`oauth-${kind}:${clientIp(header)}`, 30).allowed

  // Scoped to these paths: this app is mounted at the root of the API.
  for (const path of ["/.well-known/oauth-*", "/oauth/*"]) {
    app.use(
      path,
      cors({
        origin: "*",
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "MCP-Protocol-Version"],
      })
    )
    app.use(path, async (c, next) => {
      await next()
      c.header("Cache-Control", "no-store")
    })
  }

  const resource = () => protectedResource(deps.apiBase)
  const server = () => authorizationServer(deps.apiBase, deps.appBase)
  app.get(`/.well-known/oauth-protected-resource${PROVIDER_MCP_PATH}`, (c) => c.json(resource()))
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(resource()))
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(server()))
  app.get(`/.well-known/oauth-authorization-server${PROVIDER_MCP_PATH}`, (c) => c.json(server()))

  app.post("/oauth/register", bodyLimit({ maxSize: 8192 }), async (c) => {
    if (limited((name) => c.req.header(name), "register")) {
      return c.json({ error: "slow_down", error_description: "Too many tries. Wait a minute." }, 429)
    }
    try {
      const body = await c.req.json().catch(() => null)
      return c.json(await registerClient(deps.store, body), 201)
    } catch (error) {
      return errorResponse(error)
    }
  })

  app.post("/oauth/token", bodyLimit({ maxSize: 8192 }), async (c) => {
    if (limited((name) => c.req.header(name), "token")) {
      return c.json({ error: "slow_down", error_description: "Too many tries. Wait a minute." }, 429)
    }
    try {
      const type = c.req.header("content-type") ?? ""
      const body = type.includes("application/json")
        ? new URLSearchParams(
            Object.entries((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
              .filter(([, value]) => typeof value === "string")
              .map(([key, value]) => [key, value as string])
          )
        : new URLSearchParams(await c.req.text())
      return c.json(await exchangeCode(deps.store, deps.apiBase, body))
    } catch (error) {
      return errorResponse(error)
    }
  })

  return app
}
