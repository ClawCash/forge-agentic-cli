import qrcode from "qrcode-terminal"
import type { CliDeps } from "./deps.ts"

export interface ApprovalResult {
  id: string
  status: "approved" | "denied" | "expired" | "consumed" | "pending"
  reason: string | null
}

// Asks the reviews server for a person's approval of one agent action, shows
// the approval page as a QR code (scan it with the phone that has World ID),
// and waits until the person approves, denies, or the request expires.
export async function requestApproval(
  server: string,
  request: {
    action: "review" | "payment"
    agent: string
    details: Record<string, string>
  },
  deps: CliDeps
): Promise<ApprovalResult> {
  const res = await deps.fetch(`${server}/approvals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
  const created = (await res.json().catch(() => ({}))) as {
    id?: string
    approvalUrl?: string
    statusUrl?: string
    error?: string
  }
  if (res.status !== 201 || !created.id || !created.statusUrl) {
    throw new Error(
      `Could not request a person's approval: ${created.error ?? `HTTP ${res.status}`}`
    )
  }

  if (deps.showApproval) {
    await deps.showApproval(created.approvalUrl!)
  } else {
    deps.stderr(
      `\nA person must approve this with World ID. Scan to open the approval page:\n`
    )
    qrcode.generate(created.approvalUrl!, { small: true }, (qr) =>
      deps.stderr(`${qr}\n`)
    )
    deps.stderr(`${created.approvalUrl}\nWaiting for approval…\n`)
  }

  const deadline = Date.now() + (deps.approvalTimeoutMs ?? 11 * 60_000)
  while (true) {
    const poll = await deps.fetch(created.statusUrl)
    const status = (await poll.json().catch(() => ({}))) as ApprovalResult
    if (status.status && status.status !== "pending") {
      return {
        id: created.id,
        status: status.status,
        reason: status.reason ?? null,
      }
    }
    if (Date.now() > deadline) {
      return { id: created.id, status: "expired", reason: "Timed out waiting" }
    }
    await new Promise((resolve) => setTimeout(resolve, deps.pollMs ?? 2000))
  }
}
