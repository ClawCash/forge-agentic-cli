import { randomUUID } from "node:crypto"
import { hashSubject, pkceChallenge } from "../../server/src/world.ts"

// A stand-in for World ID's sign-in. It still enforces the parts the server
// is responsible for sending: the PKCE verifier must match the challenge and
// the nonce must match the one in the authorization request.
export function fakeWorld() {
  const codes = new Map()
  return {
    async authorizeUrl({ state, nonce, codeChallenge }) {
      const url = new URL("https://auth.world.test/authorize")
      url.search = new URLSearchParams({
        state,
        nonce,
        code_challenge: codeChallenge,
        max_age: "0",
      }).toString()
      return url.toString()
    },
    async complete({ code, codeVerifier, nonce }) {
      const entry = codes.get(code)
      if (!entry) throw new Error("Token exchange failed: invalid_grant")
      codes.delete(code)
      if (pkceChallenge(codeVerifier) !== entry.challenge) {
        throw new Error("Token exchange failed: PKCE verifier mismatch")
      }
      if (entry.nonce !== nonce) throw new Error("ID token nonce mismatch")
      if (!entry.acr) throw new Error("Not a verified World ID (no acr)")
      return {
        humanSubject: hashSubject("https://auth.world.test", entry.person),
        acr: entry.acr,
        amr: ["pop"],
        authTime: new Date(),
      }
    },
    // What World does when `person` signs in: returns the callback path.
    signIn(authorizeUrl, person, acr = "https://world.org/oidc/acr/orb") {
      const url = new URL(authorizeUrl)
      const code = randomUUID()
      codes.set(code, {
        person,
        acr,
        nonce: url.searchParams.get("nonce"),
        challenge: url.searchParams.get("code_challenge"),
      })
      return `/approvals/callback?code=${code}&state=${url.searchParams.get("state")}`
    },
  }
}

// A person handling an approval link in their browser: approve (sign in with
// World ID), cancel at World, or deny on the approval page.
export async function actOnApproval(
  app,
  world,
  approvalUrl,
  { choice = "approve", person = "person-1", acr } = {}
) {
  const path = new URL(approvalUrl).pathname
  const page = await app.request(path)
  if (page.status !== 200)
    throw new Error(`Approval page returned ${page.status}`)
  if (choice === "deny") {
    return app.request(`${path}/deny`, { method: "POST" })
  }
  const start = await app.request(`${path}/start`)
  const location = start.headers.get("location")
  if (start.status !== 302 || !location) {
    throw new Error(`Starting the sign-in returned ${start.status}`)
  }
  if (choice === "cancel") {
    const state = new URL(location).searchParams.get("state")
    return app.request(`/approvals/callback?error=access_denied&state=${state}`)
  }
  return app.request(world.signIn(location, person, acr))
}
