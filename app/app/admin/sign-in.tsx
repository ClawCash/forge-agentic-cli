"use client"

import { type FormEvent, useState } from "react"
import { Mark } from "@/components/ui"

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null)
  const data = (await res?.json().catch(() => ({}))) ?? {}
  return { ok: Boolean(res?.ok), error: data.error as string | undefined }
}

const field =
  "h-11 w-full rounded-[10px] border border-line bg-white px-3.5 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-ink"
const button =
  "h-11 w-full rounded-[10px] bg-ink text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"

export function AdminSignIn() {
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"email" | "code">("email")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await post("/admin/start", { email })
    setBusy(false)
    if (result.ok) setStep("code")
    else setError(result.error ?? "Couldn't send a code. Try again.")
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await post("/admin/verify", { email, code })
    if (result.ok) {
      window.location.reload()
      return
    }
    setBusy(false)
    setError(result.error ?? "That didn't work. Try again.")
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-paper px-4">
      <div className="panel w-full max-w-[380px] p-7">
        <Mark className="size-8" />
        <h1 className="mt-5 font-display text-[22px] font-medium tracking-[-0.02em]">
          402reviews admin
        </h1>
        {step === "email" ? (
          <form onSubmit={sendCode} className="mt-5 space-y-3">
            <label className="block">
              <span className="sr-only">Email</span>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={field}
              />
            </label>
            <button type="submit" disabled={busy} className={button}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-5 space-y-3">
            <p className="text-[14px] text-muted">
              If {email} can sign in, a code is on its way.
            </p>
            <label className="block">
              <span className="sr-only">Six-digit code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                placeholder="123456"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
                className={`${field} font-mono tracking-[0.3em]`}
              />
            </label>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className={button}
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
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-bad">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
