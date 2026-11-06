import { randomUUID } from "node:crypto"
import { Hono } from "hono"
import { html, raw } from "hono/html"
import { z } from "zod"
import type { Approval, ReviewStore } from "./db/store.ts"
import { pkceChallenge, randomToken, type WorldSignIn } from "./world.ts"

// Human approvals: an agent asks for a person to approve one action, the CLI
// shows a QR code for the approval page, and the person approves by signing
// in with World ID (or denies). Each approval is consumed exactly once.

export interface ApprovalDeps {
  store: ReviewStore
  baseUrl: string
  world: WorldSignIn | null
  ttlMs?: number
  now?: () => Date
}

const DEFAULT_TTL_MS = 10 * 60_000

const ApprovalRequest = z.object({
  action: z.enum(["review", "payment"]),
  agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  details: z
    .record(z.string().max(40), z.string().max(300))
    .refine((d) => Object.keys(d).length <= 8, "Too many details"),
})

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function summary(approval: Approval) {
  const d = approval.details
  if (approval.action === "payment") {
    return `pay $${d.amountUsd ?? "?"} USDC to ${d.endpoint ?? "an endpoint"}`
  }
  return `publish a counted review (${d.outcome ?? "?"}) of ${d.endpoint ?? "an endpoint"} for the task ${d.task ?? "?"}`
}

function page(title: string, body: ReturnType<typeof html>) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          :root {
            color-scheme: light dark;
            --fg: #111;
            --bg: #fafafa;
            --muted: #555;
            --card: #fff;
            --line: #ddd;
            --accent: #111;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --fg: #eee;
              --bg: #111;
              --muted: #aaa;
              --card: #1b1b1b;
              --line: #333;
              --accent: #eee;
            }
          }
          body {
            margin: 0;
            font:
              16px/1.5 system-ui,
              sans-serif;
            color: var(--fg);
            background: var(--bg);
          }
          main {
            max-width: 480px;
            margin: 0 auto;
            padding: 24px 16px;
          }
          .card {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 12px;
            padding: 20px;
          }
          h1 {
            font-size: 20px;
            margin: 0 0 12px;
          }
          p,
          dd {
            overflow-wrap: anywhere;
          }
          dl {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: 6px 12px;
            margin: 16px 0;
            font-size: 14px;
          }
          dt {
            color: var(--muted);
          }
          dd {
            margin: 0;
          }
          .actions {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 20px;
          }
          a.button,
          button {
            display: block;
            width: 100%;
            box-sizing: border-box;
            text-align: center;
            padding: 12px;
            border-radius: 10px;
            font: inherit;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
          }
          a.button {
            background: var(--accent);
            color: var(--bg);
            border: 0;
          }
          button {
            background: transparent;
            color: var(--fg);
            border: 1px solid var(--line);
          }
          .muted {
            color: var(--muted);
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <main><div class="card">${body}</div></main>
      </body>
    </html>`
}

function details(approval: Approval) {
  return html`<dl>
    <dt>Agent</dt>
    <dd><code>${approval.agent}</code></dd>
    ${raw(
      Object.entries(approval.details)
        .map(
          ([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`
        )
        .join("")
    )}
    <dt>Expires</dt>
    <dd>
      ${approval.expiresAt.toISOString().replace("T", " ").slice(0, 16)} UTC
    </dd>
  </dl>`
}

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  )
}

function resultPage(approval: Approval) {
  const titles: Record<string, string> = {
    approved: "Approved",
    consumed: "Approved and used",
    denied: "Not approved",
    expired: "Expired",
  }
  const title = titles[approval.status] ?? "Approval"
  return page(
    title,
    html`<h1>${title}</h1>
      <p>The agent asked to ${summary(approval)}.</p>
      ${approval.reason ? html`<p class="muted">${approval.reason}</p>` : ""}
      ${
        approval.status === "approved"
          ? html`<p class="muted">
              Verified with World ID. You can close this page; the agent
              continues on its own.
            </p>`
          : ""
      }`
  )
}

export function approvalRoutes(deps: ApprovalDeps) {
  const app = new Hono()
  const now = deps.now ?? (() => new Date())

  // Pending approvals past their deadline become expired when next read.
  async function load(id: string) {
    const approval = await deps.store.getApproval(id)
    if (approval?.status === "pending" && approval.expiresAt <= now()) {
      return (
        (await deps.store.decideApproval(id, {
          status: "expired",
          reason: "Nobody approved it in time",
        })) ?? approval
      )
    }
    return approval
  }

  app.post("/approvals", async (c) => {
    if (!deps.world) {
      return c.json({ error: "World ID is not configured on this server" }, 503)
    }
    const parsed = ApprovalRequest.safeParse(
      await c.req.json().catch(() => null)
    )
    if (!parsed.success) {
      return c.json(
        { error: "Invalid approval request", issues: parsed.error.issues },
        400
      )
    }
    const approval = await deps.store.createApproval({
      id: `apr_${randomUUID()}`,
      ...parsed.data,
      expiresAt: new Date(now().getTime() + (deps.ttlMs ?? DEFAULT_TTL_MS)),
    })
    return c.json(
      {
        id: approval.id,
        approvalUrl: `${deps.baseUrl}/approvals/${approval.id}`,
        statusUrl: `${deps.baseUrl}/approvals/${approval.id}/status`,
        expiresAt: approval.expiresAt.toISOString(),
      },
      201
    )
  })

  // World redirects here after the person signs in (or cancels).
  app.get("/approvals/callback", async (c) => {
    const { state, code, error, error_description } = c.req.query()
    const approval = state ? await deps.store.getApprovalByState(state) : null
    if (!approval) {
      return c.html(
        page(
          "Unknown approval",
          html`<h1>Unknown approval</h1>
            <p>This sign-in does not match an approval request.</p>`
        ),
        400
      )
    }
    const current = await load(approval.id)
    if (!current || current.status !== "pending") {
      return c.html(resultPage(current ?? approval))
    }
    if (error || !code) {
      const decided = await deps.store.decideApproval(approval.id, {
        status: "denied",
        reason:
          error === "access_denied"
            ? "The World ID sign-in was cancelled"
            : `World ID sign-in failed: ${error_description ?? error ?? "no code returned"}`,
      })
      return c.html(resultPage(decided ?? current))
    }
    try {
      const human = await deps.world!.complete({
        code,
        codeVerifier: current.codeVerifier ?? "",
        nonce: current.nonce ?? "",
        notBefore: current.createdAt,
      })
      const decided = await deps.store.decideApproval(approval.id, {
        status: "approved",
        humanSubject: human.humanSubject,
        acr: human.acr,
        authTime: human.authTime,
      })
      return c.html(resultPage(decided ?? current))
    } catch (err) {
      const decided = await deps.store.decideApproval(approval.id, {
        status: "denied",
        reason: (err as Error).message,
      })
      return c.html(resultPage(decided ?? current))
    }
  })

  app.get("/approvals/:id", async (c) => {
    const approval = await load(c.req.param("id"))
    if (!approval)
      return c.html(page("Not found", html`<h1>Not found</h1>`), 404)
    if (approval.status !== "pending") return c.html(resultPage(approval))
    return c.html(
      page(
        "Approve agent action",
        html`<h1>Approve this agent action?</h1>
          <p>An agent asks to ${summary(approval)}.</p>
          ${details(approval)}
          <p class="muted">
            Approving signs you in with World ID to confirm a verified person
            stands behind this agent. One approval allows one action.
          </p>
          <div class="actions">
            <a class="button" href="/approvals/${approval.id}/start"
              >Approve with World ID</a
            >
            <form method="post" action="/approvals/${approval.id}/deny">
              <button type="submit">Deny</button>
            </form>
          </div>`
      )
    )
  })

  app.get("/approvals/:id/start", async (c) => {
    const approval = await load(c.req.param("id"))
    if (!approval)
      return c.html(page("Not found", html`<h1>Not found</h1>`), 404)
    if (approval.status !== "pending" || !deps.world)
      return c.html(resultPage(approval))
    const signIn = {
      state: randomToken(),
      nonce: randomToken(),
      codeVerifier: randomToken(),
    }
    const started = await deps.store.startApproval(approval.id, signIn)
    if (!started) return c.html(resultPage(approval))
    return c.redirect(
      await deps.world.authorizeUrl({
        state: signIn.state,
        nonce: signIn.nonce,
        codeChallenge: pkceChallenge(signIn.codeVerifier),
      }),
      302
    )
  })

  app.post("/approvals/:id/deny", async (c) => {
    const approval = await load(c.req.param("id"))
    if (!approval)
      return c.html(page("Not found", html`<h1>Not found</h1>`), 404)
    const decided = await deps.store.decideApproval(approval.id, {
      status: "denied",
      reason: "Denied by the person",
    })
    return c.html(resultPage(decided ?? approval))
  })

  app.get("/approvals/:id/status", async (c) => {
    const approval = await load(c.req.param("id"))
    if (!approval) return c.json({ error: "No such approval" }, 404)
    return c.json({
      id: approval.id,
      action: approval.action,
      status: approval.status,
      reason: approval.reason,
      expiresAt: approval.expiresAt.toISOString(),
    })
  })

  // Used by the CLI before a payment above its cap: consumes the approval if
  // it was approved for this agent and action.
  app.post("/approvals/:id/consume", async (c) => {
    const body = z
      .object({ agent: z.string(), action: z.enum(["review", "payment"]) })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: "Send {agent, action}" }, 400)
    const result = await consumeApproval(
      deps.store,
      c.req.param("id"),
      body.data,
      now()
    )
    return "error" in result
      ? c.json({ error: result.error }, 409)
      : c.json({ status: "consumed" })
  })

  return app
}

// Consumes an approval for one specific action, checking it was granted for
// exactly that agent, action and (when given) details.
export async function consumeApproval(
  store: ReviewStore,
  id: string,
  expected: { agent: string; action: string; details?: Record<string, string> },
  now: Date
): Promise<Approval | { error: string }> {
  const approval = await store.getApproval(id)
  if (!approval) return { error: "No such approval" }
  if (
    !same(approval.agent, expected.agent) ||
    approval.action !== expected.action
  ) {
    return { error: "The approval was granted for a different agent or action" }
  }
  for (const [key, value] of Object.entries(expected.details ?? {})) {
    if (approval.details[key] !== value) {
      return { error: `The approval was granted for a different ${key}` }
    }
  }
  const consumed = await store.consumeApproval(id, now)
  if (!consumed) {
    return {
      error:
        approval.status === "consumed"
          ? "The approval was already used"
          : `The approval is ${approval.expiresAt <= now ? "expired" : approval.status}`,
    }
  }
  return consumed
}
