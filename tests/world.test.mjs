import assert from "node:assert/strict"
import { test } from "node:test"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { pkceChallenge, worldSignIn } from "../server/src/world.ts"

// The real ID token checks, against a local World: its own RSA key, JWKS,
// discovery document and token endpoint.
const ISSUER = "https://auth.world.test"
const CLIENT = { id: "client-123", secret: "s3cret" }
const REDIRECT = "https://demo.example/approvals/callback"

async function localWorld(claims = {}, { signWith } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const other = await generateKeyPair("RS256")
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }
  const requests = []
  const fetchWorld = async (url, init) => {
    const path = new URL(url).pathname
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    if (path === "/.well-known/openid-configuration") {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/api/v1/authorize`,
        token_endpoint: `${ISSUER}/api/v1/token`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
      })
    }
    if (path === "/.well-known/jwks.json") return json({ keys: [jwk] })
    if (path === "/api/v1/token") {
      requests.push({
        headers: init.headers,
        body: new URLSearchParams(init.body),
      })
      const now = Math.floor(Date.now() / 1000)
      const token = await new SignJWT({
        nonce: "nonce-1",
        auth_time: now,
        acr: "https://world.org/oidc/acr/orb",
        amr: ["pop"],
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(claims.iss ?? ISSUER)
        .setAudience(claims.aud ?? CLIENT.id)
        .setSubject("pairwise-subject-1")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(signWith === "other" ? other.privateKey : privateKey)
      return json({ id_token: token, token_type: "Bearer" })
    }
    return json({}, 404)
  }
  const world = worldSignIn(
    {
      issuer: ISSUER,
      clientId: CLIENT.id,
      clientSecret: CLIENT.secret,
      redirectUri: REDIRECT,
    },
    { fetch: fetchWorld }
  )
  return { world, requests }
}

const complete = (world, overrides = {}) =>
  world.complete({
    code: "code-1",
    codeVerifier: "verifier-1",
    nonce: "nonce-1",
    notBefore: new Date(Date.now() - 1000),
    ...overrides,
  })

test("builds a fresh-authentication PKCE authorization request", async () => {
  const { world } = await localWorld()
  const url = new URL(
    await world.authorizeUrl({
      state: "st",
      nonce: "nn",
      codeChallenge: pkceChallenge("v"),
    })
  )
  assert.equal(url.origin + url.pathname, `${ISSUER}/api/v1/authorize`)
  const params = Object.fromEntries(url.searchParams)
  assert.deepEqual(params, {
    response_type: "code",
    client_id: CLIENT.id,
    redirect_uri: REDIRECT,
    scope: "openid",
    state: "st",
    nonce: "nn",
    code_challenge: pkceChallenge("v"),
    code_challenge_method: "S256",
    max_age: "0",
  })
})

test("exchanges the code with Basic auth and accepts a valid ID token", async () => {
  const { world, requests } = await localWorld()
  const human = await complete(world)
  assert.equal(human.acr, "https://world.org/oidc/acr/orb")
  assert.match(human.humanSubject, /^[0-9a-f]{64}$/)
  assert.ok(human.authTime instanceof Date)
  const [request] = requests
  assert.equal(
    request.headers.Authorization,
    `Basic ${Buffer.from(`${CLIENT.id}:${CLIENT.secret}`).toString("base64")}`
  )
  assert.equal(request.body.get("grant_type"), "authorization_code")
  assert.equal(request.body.get("code_verifier"), "verifier-1")
  assert.equal(request.body.get("redirect_uri"), REDIRECT)
})

test("rejects tokens that fail any check", async () => {
  const cases = [
    [{ nonce: "someone-else" }, {}, /nonce mismatch/],
    [{ auth_time: Math.floor(Date.now() / 1000) - 3600 }, {}, /not fresh/],
    [{ acr: undefined }, {}, /no acr/],
    [{ aud: "another-client" }, {}, /aud/],
    [{ iss: "https://evil.example" }, {}, /iss/],
    [{}, { signWith: "other" }, /signature/],
  ]
  for (const [claims, options, error] of cases) {
    const { world } = await localWorld(claims, options)
    await assert.rejects(complete(world), error)
  }
})
