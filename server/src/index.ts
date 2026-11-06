import { serve } from "@hono/node-server"
import { Hono } from "hono"

export const app = new Hono()

app.get("/health", (c) => c.json({ ok: true }))

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, port })
  console.log(`server listening on http://localhost:${port}`)
}
