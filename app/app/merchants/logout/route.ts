import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { MERCHANT_COOKIE, merchantApi } from "@/lib/merchant"

export const dynamic = "force-dynamic"

export async function POST() {
  const token = (await cookies()).get(MERCHANT_COOKIE)?.value
  if (token) await merchantApi("logout", { token })
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: "/merchants" },
  })
  res.cookies.delete(MERCHANT_COOKIE)
  return res
}
