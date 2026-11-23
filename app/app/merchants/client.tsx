"use client"

import { Check, Copy, ExternalLink } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, type ReactNode, useState } from "react"
import type { Claim, MerchantProfile } from "@/lib/merchant"

const field =
  "h-11 w-full rounded-[10px] border border-line bg-white px-3.5 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-ink"
const area =
  "w-full rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-ink"
const primary =
  "inline-flex h-11 items-center justify-center rounded-[10px] bg-ink px-5 text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
const secondary =
  "inline-flex h-10 items-center justify-center rounded-[10px] border border-line bg-white px-4 text-[14px] font-medium transition-colors hover:border-faint disabled:opacity-50"

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null)
  const data = ((await res?.json().catch(() => ({}))) ?? {}) as Record<
    string,
    unknown
  >
  return { ok: Boolean(res?.ok), data }
}

const act = (action: string, domain: string, body?: unknown) =>
  post("/merchants/action", { action, domain, body })

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-3 text-[13px] text-bad">
      {children}
    </p>
  )
}

export function MerchantSignIn() {
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"email" | "code">("email")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { ok, data } = await post("/merchants/start", { email })
    setBusy(false)
    if (ok) setStep("code")
    else setError(String(data.error ?? "Couldn't send a code. Try again."))
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { ok, data } = await post("/merchants/verify", { email, code })
    if (ok) {
      window.location.reload()
      return
    }
    setBusy(false)
    setError(String(data.error ?? "That didn't work. Try again."))
  }

  return (
    <div className="panel p-6 sm:p-7">
      <h2 className="font-display text-[20px] font-medium tracking-[-0.02em]">
        Sign in to claim your API
      </h2>
      <p className="mt-1 text-[14px] text-muted">
        We'll email you a 6-digit code.
      </p>
      {step === "email" ? (
        <form onSubmit={sendCode} className="mt-5 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            aria-label="Email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={field}
          />
          <button type="submit" disabled={busy} className={`${primary} w-full`}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-5 space-y-3">
          <p className="text-[14px] text-muted">We sent a code to {email}.</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            aria-label="Six-digit code"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className={`${field} font-mono tracking-[0.3em]`}
          />
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className={`${primary} w-full`}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("email")
              setCode("")
              setError(null)
            }}
            className="w-full text-[13px] text-muted hover:text-ink"
          >
            Use a different email
          </button>
        </form>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  )
}

export function ClaimForm({ initial = "" }: { initial?: string }) {
  const router = useRouter()
  const [domain, setDomain] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function claim(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { ok, data } = await act("claim", "", { domain })
    setBusy(false)
    if (!ok) {
      setError(String(data.error ?? "Couldn't claim that domain."))
      return
    }
    setDomain("")
    router.refresh()
  }

  return (
    <form onSubmit={claim}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          required
          aria-label="Your API's domain"
          placeholder="api.yourcompany.com"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          className={`${field} font-mono text-[14px]`}
        />
        <button type="submit" disabled={busy} className={`${primary} shrink-0`}>
          {busy ? "Claiming…" : "Claim API"}
        </button>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </form>
  )
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1.5 flex items-center gap-2 rounded-[10px] border border-line bg-paper py-1.5 pr-1.5 pl-3">
        <code
          className="min-w-0 flex-1 truncate font-mono text-[13px]"
          title={value}
        >
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
          }}
          className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-white hover:text-ink"
        >
          {copied ? (
            <Check className="size-4 text-ok" />
          ) : (
            <Copy className="size-4" />
          )}
        </button>
      </div>
    </div>
  )
}

function Verify({ claim }: { claim: Claim }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(claim.last_error)
  const steps = claim.verification
  if (!steps) return null

  async function check() {
    setBusy(true)
    setError(null)
    const { ok, data } = await act("check", claim.domain)
    setBusy(false)
    if (!ok) setError(String(data.error ?? "Couldn't check. Try again."))
    else if (data.status !== "verified")
      setError(String(data.last_error ?? "Not verified yet."))
    router.refresh()
  }

  return (
    <div className="mt-5">
      <p className="text-[14px] text-muted">
        Prove you own {claim.domain} with either one of these, then check.
      </p>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div className="space-y-3 rounded-[12px] border border-line p-4">
          <div className="text-[14px] font-medium">
            Option 1: DNS TXT record
          </div>
          <CopyValue label="Name" value={steps.dns.name} />
          <CopyValue label="Value" value={steps.dns.value} />
        </div>
        <div className="space-y-3 rounded-[12px] border border-line p-4">
          <div className="text-[14px] font-medium">
            Option 2: a file on your domain
          </div>
          <CopyValue label="URL" value={steps.file.url} />
          <CopyValue label="Contents" value={steps.file.contents} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className={primary}
        >
          {busy ? "Checking…" : "Check now"}
        </button>
        <span className="text-[13px] text-muted">
          DNS changes can take a few minutes.
        </span>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  )
}

const PROFILE_FIELDS: [keyof MerchantProfile, string, string][] = [
  ["name", "API name", "Example Data"],
  ["docs_url", "Docs", "https://docs.example.com"],
  ["spec_url", "OpenAPI spec", "https://api.example.com/openapi.json"],
  ["pricing_url", "Pricing", "https://example.com/pricing"],
  ["contact_email", "Contact email (private)", "api@example.com"],
]

function ProfileForm({ claim }: { claim: Claim }) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(() => ({
    name: claim.profile?.name ?? "",
    description: claim.profile?.description ?? "",
    docs_url: claim.profile?.docs_url ?? "",
    spec_url: claim.profile?.spec_url ?? "",
    pricing_url: claim.profile?.pricing_url ?? "",
    contact_email: claim.profile?.contact_email ?? "",
  }))
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setState("busy")
    setError(null)
    const { ok, data } = await act("profile", claim.domain, values)
    if (!ok) {
      setState("idle")
      setError(String(data.error ?? "Couldn't save."))
      return
    }
    setState("saved")
    router.refresh()
  }

  const set = (key: string) => (value: string) => {
    setValues((old) => ({ ...old, [key]: value }))
    setState("idle")
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {PROFILE_FIELDS.map(([key, label, placeholder]) => (
          <label key={key} className="block">
            <span className="label">{label}</span>
            <input
              value={values[key]}
              placeholder={placeholder}
              onChange={(event) => set(key)(event.target.value)}
              className={`${field} mt-1.5 h-10 text-[14px]`}
            />
          </label>
        ))}
      </div>
      <label className="block">
        <span className="label">Short description</span>
        <textarea
          rows={2}
          maxLength={280}
          value={values.description}
          placeholder="What your API does, in a sentence or two."
          onChange={(event) => set("description")(event.target.value)}
          className={`${area} mt-1.5`}
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "busy"} className={secondary}>
          {state === "busy" ? "Saving…" : "Save profile"}
        </button>
        {state === "saved" && (
          <span className="flex items-center gap-1 text-[13px] text-ok">
            <Check className="size-4" /> Saved
          </span>
        )}
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </form>
  )
}

function SeedingForm({
  claim,
  maxPrice,
  maxEndpoints,
}: {
  claim: Claim
  maxPrice: number
  maxEndpoints: number
}) {
  const router = useRouter()
  const [endpoints, setEndpoints] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<
    { url: string; problem: string | null; price_usd: number | null }[]
  >([])
  const open = claim.seeding_requests?.find(
    (request) => request.status === "open"
  )

  async function request(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setProblems([])
    const list = endpoints
      .split(/\s+/)
      .map((line) => line.trim())
      .filter(Boolean)
    const { ok, data } = await act("seeding", claim.domain, {
      endpoints: list,
      notes,
    })
    setBusy(false)
    if (!ok) {
      setError(String(data.error ?? "Couldn't send the request."))
      if (Array.isArray(data.endpoints)) setProblems(data.endpoints)
      return
    }
    setEndpoints("")
    setNotes("")
    router.refresh()
  }

  return (
    <div>
      {open ? (
        <p className="text-[14px] text-muted">
          Your seeding request is in. We'll pay for the calls, review what comes
          back honestly, and update its status here.
        </p>
      ) : (
        <form onSubmit={request} className="space-y-3">
          <p className="text-[14px] text-muted">
            List up to {maxEndpoints} endpoints on {claim.domain} that cost $
            {maxPrice} or less a call. We pay for the calls and post honest
            reviews, labelled as seeded.
          </p>
          <textarea
            rows={3}
            required
            aria-label="Endpoint URLs, one per line"
            value={endpoints}
            placeholder={`https://${claim.domain}/v1/search`}
            onChange={(event) => setEndpoints(event.target.value)}
            className={`${area} font-mono text-[13px]`}
          />
          <textarea
            rows={2}
            maxLength={1000}
            aria-label="Notes for the reviewer"
            value={notes}
            placeholder="Optional: a workflow to try, or sample inputs."
            onChange={(event) => setNotes(event.target.value)}
            className={area}
          />
          <button type="submit" disabled={busy} className={primary}>
            {busy ? "Checking prices…" : "Request seeding"}
          </button>
          {error && <ErrorLine>{error}</ErrorLine>}
          {problems.length > 0 && (
            <ul className="space-y-1.5 text-[13px]">
              {problems.map((item) => (
                <li key={item.url} className="flex gap-2">
                  {item.problem ? (
                    <span className="text-bad">✕</span>
                  ) : (
                    <Check className="mt-0.5 size-3.5 text-ok" />
                  )}
                  <span className="min-w-0">
                    <span className="font-mono break-all">{item.url}</span>
                    <span className="text-muted">
                      {" "}
                      {item.problem ?? `$${item.price_usd} a call`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
      {claim.seeding_requests && claim.seeding_requests.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-[12px] border border-line">
          {claim.seeding_requests.map((item) => (
            <li key={item.id} className="p-4 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">
                  Requested{" "}
                  {new Date(item.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <StatusPill status={item.status} />
              </div>
              <ul className="mt-2 space-y-1">
                {item.endpoints.map((endpoint) => (
                  <li key={endpoint.url} className="flex justify-between gap-3">
                    <span
                      className="min-w-0 truncate font-mono"
                      title={endpoint.url}
                    >
                      {endpoint.url}
                    </span>
                    <span className="shrink-0 text-muted">
                      ${endpoint.price_usd}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const style =
    status === "verified" || status === "seeded"
      ? "bg-[#e8f4ee] text-ok ring-[#cfe7da]"
      : status === "declined"
        ? "bg-[#fbeceb] text-bad ring-[#f3d3d0]"
        : "bg-paper text-muted ring-line"
  const label: Record<string, string> = {
    verified: "Verified",
    pending: "Pending verification",
    open: "Requested",
    seeded: "Seeded",
    declined: "Declined",
  }
  return (
    <span
      className={`rounded-[6px] px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ${style}`}
    >
      {label[status] ?? status}
    </span>
  )
}

export function ClaimCard({
  claim,
  maxPrice,
  maxEndpoints,
}: {
  claim: Claim
  maxPrice: number
  maxEndpoints: number
}) {
  const verified = claim.status === "verified"
  return (
    <section className="rounded-[14px] border border-line bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="truncate font-mono text-[16px] font-medium">
            {claim.domain}
          </h3>
          <StatusPill status={claim.status} />
        </div>
        {verified && (
          <a
            href={`/s/${claim.domain}`}
            className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"
          >
            View its page <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      {!verified && <Verify claim={claim} />}
      {verified && (
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <div>
            <h4 className="text-[15px] font-medium">Profile</h4>
            <p className="mt-1 mb-4 text-[13px] text-muted">
              Shown on your API's page. It never changes a rating.
            </p>
            <ProfileForm claim={claim} />
          </div>
          <div>
            <h4 className="text-[15px] font-medium">Seeding</h4>
            <div className="mt-1">
              <SeedingForm
                claim={claim}
                maxPrice={maxPrice}
                maxEndpoints={maxEndpoints}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
