"use client"

import { Check, Copy, ExternalLink } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, type ReactNode, useState } from "react"
import type { Claim } from "@/lib/merchant"

const field =
  "h-11 w-full rounded-[10px] border border-line bg-white px-3.5 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-ink"
const primary =
  "inline-flex h-10 shrink-0 items-center whitespace-nowrap justify-center rounded-[10px] bg-ink px-4 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
const secondary =
  "inline-flex h-10 shrink-0 items-center whitespace-nowrap justify-center rounded-[10px] border border-line bg-white px-4 text-[14px] font-medium transition-colors hover:border-faint disabled:opacity-50"

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

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-3 text-[13px] text-bad">
      {children}
    </p>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.57-5.15 3.57-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.87-3c-1.08.72-2.45 1.15-4.08 1.15-3.13 0-5.79-2.12-6.74-4.97H1.27v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.26 14.26a7.2 7.2 0 0 1 0-4.52v-3.1H1.27a12 12 0 0 0 0 10.72l3.99-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.43-3.43A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.27 6.64l3.99 3.1C6.21 6.89 8.87 4.77 12 4.77Z"
      />
    </svg>
  )
}

export function MerchantSignIn({
  google = false,
  googleFailed = false,
}: {
  google?: boolean
  googleFailed?: boolean
}) {
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
        Sign in
      </h2>
      <p className="mt-1 text-[14px] text-muted">
        {step === "email"
          ? "We'll email you a 6-digit code."
          : `We sent a code to ${email}.`}
      </p>
      {googleFailed && (
        <ErrorLine>
          Google sign-in didn&apos;t finish. Try again, or use your email.
        </ErrorLine>
      )}
      {google && step === "email" && (
        <>
          <a
            href="/merchants/google"
            className="mt-5 flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-line bg-white text-[15px] font-medium transition-colors hover:border-faint"
          >
            <GoogleMark />
            Continue with Google
          </a>
          <div className="my-4 flex items-center gap-3 text-[12px] text-faint">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      {step === "email" ? (
        <form
          onSubmit={sendCode}
          className={google ? "space-y-3" : "mt-5 space-y-3"}
        >
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
          <button
            type="submit"
            disabled={busy}
            className={`${primary} h-11 w-full text-[15px]`}
          >
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-5 space-y-3">
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
            className={`${primary} h-11 w-full text-[15px]`}
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
      <div className="flex gap-2">
        <input
          required
          aria-label="Your API's domain"
          placeholder="api.yourcompany.com"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          className={`${field} h-10 font-mono text-[14px]`}
        />
        <button type="submit" disabled={busy} className={`${primary} shrink-0`}>
          {busy ? "Adding…" : "Add API"}
        </button>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </form>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-14 shrink-0 text-[13px] text-muted">{label}</span>
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
        className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-paper hover:text-ink"
      >
        {copied ? (
          <Check className="size-4 text-ok" />
        ) : (
          <Copy className="size-4" />
        )}
      </button>
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
    <div className="mt-4">
      <p className="text-[14px] text-muted">
        Add this DNS record to prove you own {claim.domain}.
      </p>
      <div className="mt-3 divide-y divide-line rounded-[10px] border border-line px-3">
        <CopyRow label="Type" value="TXT" />
        <CopyRow label="Name" value={steps.dns.name} />
        <CopyRow label="Value" value={steps.dns.value} />
      </div>
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer text-muted hover:text-ink">
          Can&apos;t edit DNS? Use a file instead
        </summary>
        <div className="mt-2 divide-y divide-line rounded-[10px] border border-line px-3">
          <CopyRow label="URL" value={steps.file.url} />
          <CopyRow label="Text" value={steps.file.contents} />
        </div>
      </details>
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
          DNS can take a few minutes.
        </span>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  )
}

function Seeding({ claim }: { claim: Claim }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = claim.seeding_requests?.[0]

  async function ask() {
    setBusy(true)
    setError(null)
    const { ok, data } = await act("seeding", claim.domain, {})
    setBusy(false)
    if (!ok) {
      setError(String(data.error ?? "Couldn't send the request."))
      return
    }
    router.refresh()
  }

  if (request) {
    const line =
      request.status === "seeded"
        ? `Seeded on ${day(request.updated_at)}. The reviews are on your API's page.`
        : request.status === "declined"
          ? "We couldn't seed this API. Reply to our email if you'd like to know why."
          : `Seeding requested on ${day(request.created_at)}. We'll email you when the reviews are up.`
    return (
      <p className="flex items-start gap-2 text-[14px]">
        {request.status !== "declined" && (
          <Check className="mt-0.5 size-4 shrink-0 text-ok" />
        )}
        <span className={request.status === "declined" ? "text-muted" : ""}>
          {line}
        </span>
      </p>
    )
  }
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px] text-muted">
          We&apos;ll pay for a few real calls to your API and post honest
          reviews.
        </p>
        <button
          type="button"
          onClick={ask}
          disabled={busy}
          className={`${primary} shrink-0`}
        >
          {busy ? "Sending…" : "Request seeding"}
        </button>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  )
}

function ProfileForm({ claim }: { claim: Claim }) {
  const router = useRouter()
  const [values, setValues] = useState({
    name: claim.profile?.name ?? "",
    description: claim.profile?.description ?? "",
    docs_url: claim.profile?.docs_url ?? "",
  })
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setState("busy")
    setError(null)
    const { ok, data } = await act("profile", claim.domain, {
      ...values,
      spec_url: claim.profile?.spec_url ?? "",
      pricing_url: claim.profile?.pricing_url ?? "",
      contact_email: claim.profile?.contact_email ?? "",
    })
    if (!ok) {
      setState("idle")
      setError(String(data.error ?? "Couldn't save."))
      return
    }
    setState("saved")
    router.refresh()
  }

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((old) => ({ ...old, [key]: value }))
    setState("idle")
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-3">
      <label className="block">
        <span className="text-[13px] font-medium">Name</span>
        <input
          value={values.name}
          maxLength={60}
          placeholder="Acme Data"
          onChange={(event) => set("name")(event.target.value)}
          className={`${field} mt-1.5 h-10 text-[14px]`}
        />
      </label>
      <label className="block">
        <span className="text-[13px] font-medium">What it does</span>
        <input
          value={values.description}
          maxLength={280}
          placeholder="Market data for trading agents."
          onChange={(event) => set("description")(event.target.value)}
          className={`${field} mt-1.5 h-10 text-[14px]`}
        />
      </label>
      <label className="block">
        <span className="text-[13px] font-medium">Docs link</span>
        <input
          value={values.docs_url}
          placeholder="https://docs.yourcompany.com"
          onChange={(event) => set("docs_url")(event.target.value)}
          className={`${field} mt-1.5 h-10 text-[14px]`}
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "busy"} className={secondary}>
          {state === "busy" ? "Saving…" : "Save"}
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

export function ClaimCard({ claim }: { claim: Claim }) {
  const verified = claim.status === "verified"
  return (
    <section className="rounded-[14px] border border-line bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h3 className="truncate font-mono text-[15px] font-medium">
            {claim.domain}
          </h3>
          <span
            className={`shrink-0 rounded-[6px] px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ${
              verified
                ? "bg-[#e8f4ee] text-ok ring-[#cfe7da]"
                : "bg-paper text-muted ring-line"
            }`}
          >
            {verified ? "Verified" : "Not verified yet"}
          </span>
        </div>
        {verified && (
          <a
            href={`/s/${claim.domain}`}
            className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted hover:text-ink"
          >
            Its page <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      {!verified && <Verify claim={claim} />}
      {verified && (
        <>
          <div className="mt-4 border-t border-line pt-4">
            <Seeding claim={claim} />
          </div>
          <details className="mt-4 border-t border-line pt-4 text-[14px]">
            <summary className="cursor-pointer text-muted hover:text-ink">
              Add your docs and links (optional)
            </summary>
            <ProfileForm claim={claim} />
          </details>
        </>
      )}
    </section>
  )
}
