import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { MERCHANT_COOKIE, merchantApi, onProviderHost } from "@/lib/merchant"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const token = (await cookies()).get(MERCHANT_COOKIE)?.value
  if (token) await merchantApi("logout", { token })
  // A relative Location keeps the browser on the host it signed out from.
  const host = request.headers.get("host") ?? ""
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: onProviderHost(host) ? "/" : "/merchants" },
  })
  res.cookies.delete(MERCHANT_COOKIE)
  return res
}
