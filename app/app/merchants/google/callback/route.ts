import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { GOOGLE_COOKIE, MERCHANT_COOKIE, merchantApi } from "@/lib/merchant"

export const dynamic = "force-dynamic"

const back = (path: string) =>
  new NextResponse(null, { status: 303, headers: { Location: path } })

// Google sends the merchant back here with a code. The state must match the
// cookie set on the way out, so a stranger can't sign someone in.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const [state, verifier] = (
    (await cookies()).get(GOOGLE_COOKIE)?.value ?? ""
  ).split(".")
  const code = url.searchParams.get("code")
  if (!code || !state || !verifier || url.searchParams.get("state") !== state) {
    return back("/merchants?error=google")
  }
  const { status, data } = await merchantApi("google", {
    body: {
      code,
      redirect_uri: `${url.origin}/merchants/google/callback`,
      code_verifier: verifier,
    },
  })
  if (status !== 200 || typeof data.token !== "string")
    return back("/merchants?error=google")
  const res = back("/merchants")
  res.cookies.set(MERCHANT_COOKIE, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(String(data.expires_at)),
  })
  res.cookies.set(GOOGLE_COOKIE, "", { path: "/merchants/google", maxAge: 0 })
  return res
}
