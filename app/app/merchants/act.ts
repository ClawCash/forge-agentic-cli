// One endpoint for the page's buttons, so the session token stays in its cookie.
export async function act(action: string, domain: string, body: unknown) {
  const res = await fetch("/merchants/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, domain, body }),
  }).catch(() => null)
  const data = ((await res?.json().catch(() => ({}))) ?? {}) as Record<
    string,
    unknown
  >
  return { ok: !!res?.ok, data }
}
