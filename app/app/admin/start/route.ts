import { forward } from "@/lib/admin"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown
  } | null
  const { status, data } = await forward("start", { email: body?.email })
  return Response.json(data, { status })
}
