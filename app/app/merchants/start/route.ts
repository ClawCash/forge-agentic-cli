import { merchantApi } from "@/lib/merchant"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown
  } | null
  const { status, data } = await merchantApi("start", {
    body: { email: body?.email },
  })
  return Response.json(data, { status })
}
