import qrcode from "qrcode-terminal"
import type { CliDeps } from "./deps.ts"

export interface ApprovalResult {
  id: string
  status: "approved" | "denied" | "expired" | "consumed" | "pending"
  reason: string | null
  approvalUrl?: string
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
  deps: CliDeps,
  // Resume waiting on an approval requested earlier (for example after the
  // CLI was interrupted) instead of requesting a new one.
  existingId?: string,
  // false: request the approval and return at once (status "pending"), for
  // agents whose tools only show output when a command finishes.
  wait = true
): Promise<ApprovalResult> {
  if (existingId) {
    if (!/^apr_[0-9a-f-]{36}$/.test(existingId)) {
      throw new Error(`Invalid approval id: ${existingId}`)
    }
    deps.stderr(`Waiting for approval ${server}/approvals/${existingId}\n`)
    return waitFor(existingId, `${server}/approvals/${existingId}/status`, deps)
  }
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

  if (!wait) {
    return {
      id: created.id,
      status: "pending",
      reason: null,
      approvalUrl: created.approvalUrl,
    }
  }
  if (deps.showApproval) {
    await deps.showApproval(created.approvalUrl!)
  } else {
    deps.stderr(
      `\nA person must approve this with World ID. Scan to open the approval page:\n`
    )
    deps.stderr(qrFor(created.approvalUrl!))
    deps.stderr(`${created.approvalUrl}\nWaiting for approval…\n`)
  }
  return waitFor(created.id, created.statusUrl, deps)
}

// The link as a QR code drawn with terminal characters.
export function qrFor(url: string): string {
  let out = ""
  qrcode.generate(url, { small: true }, (qr) => (out = `${qr}\n`))
  return out
}

export async function waitFor(
  id: string,
  statusUrl: string,
  deps: CliDeps
): Promise<ApprovalResult> {
  const deadline = Date.now() + (deps.approvalTimeoutMs ?? 11 * 60_000)
  while (true) {
    const poll = await deps.fetch(statusUrl)
    const status = (await poll.json().catch(() => ({}))) as ApprovalResult
    if (status.status && status.status !== "pending") {
      return { id, status: status.status, reason: status.reason ?? null }
    }
    if (Date.now() > deadline) {
      return { id, status: "expired", reason: "Timed out waiting" }
    }
    await new Promise((resolve) => setTimeout(resolve, deps.pollMs ?? 2000))
  }
}
