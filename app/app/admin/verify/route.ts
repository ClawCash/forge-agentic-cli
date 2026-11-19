import { NextResponse } from "next/server"
import { ADMIN_COOKIE, forward } from "@/lib/admin"

export const dynamic = "force-dynamic"

// Keeps the session token in an httpOnly cookie for this host only.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown
    code?: unknown
  } | null
  const { status, data } = await forward("verify", {
    email: body?.email,
    code: body?.code,
  })
  if (status !== 200 || typeof data.token !== "string") {
    return NextResponse.json(
      { error: data.error ?? "Sign-in failed. Try again." },
      { status: status === 200 ? 502 : status }
    )
  }
  const res = NextResponse.json({ signed_in: true })
  res.cookies.set(ADMIN_COOKIE, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(String(data.expires_at)),
  })
  return res
}
