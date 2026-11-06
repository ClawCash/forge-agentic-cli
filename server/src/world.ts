import { createHash, randomBytes } from "node:crypto"
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose"

// World ID Agent Pass: World's OpenID Connect sign-in (auth.world.org). The
// server runs the authorization code flow with PKCE and checks the ID token
// itself; nothing the browser or the agent reports is trusted on its own.

export interface WorldConfig {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface HumanApproval {
  // Hash of issuer and the app-specific World ID subject: the same person
  // always maps to the same value here, and it cannot be linked elsewhere.
  humanSubject: string
  acr: string | null
  amr: string[]
  authTime: Date
}

export interface WorldSignIn {
  authorizeUrl(params: {
    state: string
    nonce: string
    codeChallenge: string
  }): Promise<string>
  // Exchanges the code and verifies the ID token. Throws with a readable
  // reason when anything is off.
  complete(params: {
    code: string
    codeVerifier: string
    nonce: string
    notBefore: Date
  }): Promise<HumanApproval>
}

const base64url = (bytes: Buffer) => bytes.toString("base64url")
export const randomToken = () => base64url(randomBytes(32))
export const pkceChallenge = (verifier: string) =>
  base64url(createHash("sha256").update(verifier).digest())
export const hashSubject = (issuer: string, subject: string) =>
  createHash("sha256").update(`${issuer}|${subject}`).digest("hex")

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

// Allowed clock skew when checking that the sign-in happened after the
// approval page was opened.
const SKEW_MS = 30_000

export function worldSignIn(
  config: WorldConfig,
  deps: { fetch: typeof fetch } = { fetch }
): WorldSignIn {
  let discovery: Promise<Discovery> | undefined
  let jwks: ReturnType<typeof createLocalJWKSet> | undefined
  // World's signing keys, fetched through deps.fetch and cached.
  const keys = async (meta: Discovery, refresh = false) => {
    if (!jwks || refresh) {
      const res = await deps.fetch(meta.jwks_uri)
      if (!res.ok) throw new Error(`World keys unavailable: HTTP ${res.status}`)
      jwks = createLocalJWKSet((await res.json()) as JSONWebKeySet)
    }
    return jwks
  }
  const discover = () =>
    (discovery ??= deps
      .fetch(`${config.issuer}/.well-known/openid-configuration`)
      .then((res) => {
        if (!res.ok)
          throw new Error(`World discovery failed: HTTP ${res.status}`)
        return res.json() as Promise<Discovery>
      })
      .catch((error) => {
        discovery = undefined
        throw error
      }))

  return {
    async authorizeUrl({ state, nonce, codeChallenge }) {
      const { authorization_endpoint } = await discover()
      const url = new URL(authorization_endpoint)
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: "openid",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        // Fresh authentication for this action, not a reused session.
        max_age: "0",
      }).toString()
      return url.toString()
    },

    async complete({ code, codeVerifier, nonce, notBefore }) {
      const meta = await discover()
      const res = await deps.fetch(meta.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`
          ).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          code_verifier: codeVerifier,
        }),
      })
      const tokens = (await res.json().catch(() => ({}))) as {
        id_token?: string
        error?: string
        error_description?: string
      }
      if (!res.ok || !tokens.id_token) {
        throw new Error(
          `Token exchange failed: ${tokens.error_description ?? tokens.error ?? `HTTP ${res.status}`}`
        )
      }
      const options = {
        issuer: meta.issuer,
        audience: config.clientId,
        algorithms: ["RS256"],
      }
      let payload
      try {
        ;({ payload } = await jwtVerify(
          tokens.id_token,
          await keys(meta),
          options
        ))
      } catch (error) {
        // World may have rotated its keys since they were cached.
        if ((error as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") {
          throw error
        }
        ;({ payload } = await jwtVerify(
          tokens.id_token,
          await keys(meta, true),
          options
        ))
      }
      if (payload.nonce !== nonce) throw new Error("ID token nonce mismatch")
      if (typeof payload.sub !== "string")
        throw new Error("ID token has no subject")
      if (typeof payload.auth_time !== "number") {
        throw new Error("ID token has no auth_time")
      }
      const authTime = new Date(payload.auth_time * 1000)
      if (authTime.getTime() < notBefore.getTime() - SKEW_MS) {
        throw new Error("The sign-in was not fresh")
      }
      // Accounts without Orb or Selfie Check verification get no acr.
      const acr = typeof payload.acr === "string" ? payload.acr : null
      if (!acr) throw new Error("Not a verified World ID (no acr)")
      return {
        humanSubject: hashSubject(meta.issuer, payload.sub),
        acr,
        amr: Array.isArray(payload.amr) ? (payload.amr as string[]) : [],
        authTime,
      }
    },
  }
}
