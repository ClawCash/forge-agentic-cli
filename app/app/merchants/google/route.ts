import { createHash, randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { GOOGLE_COOKIE, merchantApi } from "@/lib/merchant"

export const dynamic = "force-dynamic"

// Sends the merchant to Google, with a one-time state and PKCE verifier kept
// in a short-lived cookie for the callback to check.
export async function GET(request: Request) {
  const { data } = await merchantApi("config", { method: "GET" })
  const clientId =
    typeof data.google_client_id === "string" ? data.google_client_id : null
  if (!clientId) {
    return new NextResponse(null, {
      status: 303,
      headers: { Location: "/merchants?error=google" },
    })
  }
  const state = randomBytes(16).toString("hex")
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${new URL(request.url).origin}/merchants/google/callback`,
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString()
  const res = NextResponse.redirect(url, 303)
  res.cookies.set(GOOGLE_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/merchants/google",
    maxAge: 600,
  })
  return res
}
