"use client"

import { AnimatePresence, motion } from "motion/react"
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react"
import { Mark } from "@/components/ui"

const SMOOTH = { type: "spring", stiffness: 380, damping: 34 } as const
const RESEND_SECONDS = 30

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

// Six boxes for the emailed code. Typing moves along, Backspace moves back,
// and a pasted code fills them all.
function CodeBoxes({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (code: string) => void
  disabled: boolean
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const focus = (index: number) =>
    boxes.current[Math.max(0, Math.min(5, index))]?.focus()

  useEffect(() => focus(0), [])

  function put(index: number, digits: string) {
    const next = (
      value.slice(0, index) +
      digits +
      value.slice(index + digits.length)
    ).slice(0, 6)
    onChange(next.replace(/\D/g, ""))
    focus(index + digits.length)
  }

  function key(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !value[index]) {
      event.preventDefault()
      onChange(value.slice(0, Math.max(0, index - 1)) + value.slice(index))
      focus(index - 1)
    } else if (event.key === "ArrowLeft") focus(index - 1)
    else if (event.key === "ArrowRight") focus(index + 1)
  }

  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const digits = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6)
    if (!digits) return
    event.preventDefault()
    onChange(digits)
    focus(digits.length)
  }

  return (
    <div
      className="flex justify-between gap-2"
      role="group"
      aria-label="Six-digit code"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element
          }}
          value={value[index] ?? ""}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${index + 1}`}
          maxLength={6}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "")
            if (!digits) return
            // Typing over a filled box replaces its digit; a longer value is a paste or autofill.
            put(
              index,
              digits.length > 1 && value[index] ? digits.slice(-1) : digits
            )
          }}
          onKeyDown={(event) => key(index, event)}
          onPaste={paste}
          onFocus={(event) => event.target.select()}
          className="h-14 w-full min-w-0 rounded-[12px] border border-line bg-white text-center font-mono text-[22px] outline-none transition-[border-color,box-shadow] duration-150 focus:border-ink focus:shadow-[0_0_0_3px_rgb(12_14_18/0.08)] disabled:opacity-60"
        />
      ))}
    </div>
  )
}

export function SignIn({
  google = false,
  googleFailed = false,
}: {
  google?: boolean
  googleFailed?: boolean
}) {
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"email" | "code">("email")
  const [error, setError] = useState<string | null>(
    googleFailed
      ? "Google sign-in didn't finish. Try again, or use your email."
      : null
  )
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  async function sendCode(event?: FormEvent) {
    event?.preventDefault()
    setBusy(true)
    setError(null)
    const { ok, data } = await post("/merchants/start", { email })
    setBusy(false)
    if (!ok) {
      setError(String(data.error ?? "Couldn't send a code. Try again."))
      return
    }
    setStep("code")
    setCode("")
    setWait(RESEND_SECONDS)
  }

  async function verify(full: string) {
    setBusy(true)
    setError(null)
    const { ok, data } = await post("/merchants/verify", { email, code: full })
    if (ok) {
      window.location.reload()
      return
    }
    setBusy(false)
    setCode("")
    setError(String(data.error ?? "That code didn't work. Try again."))
  }

  function typed(next: string) {
    setCode(next)
    setError(null)
    if (next.length === 6) void verify(next)
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-paper px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SMOOTH}
        className="panel w-full max-w-[400px] p-7 sm:p-8"
      >
        <a href="https://402reviews.xyz" aria-label="402reviews home">
          <Mark className="size-9" />
        </a>
        <AnimatePresence mode="wait" initial={false}>
          {step === "email" ? (
            <motion.div
              key="email"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={SMOOTH}
            >
              <h1 className="mt-6 font-display text-[24px] font-medium tracking-[-0.02em]">
                Sign in to 402reviews
              </h1>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                See every review of your API and what agents ran into.
              </p>
              {google && (
                <>
                  <a
                    href="/merchants/google"
                    className="mt-6 flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-line bg-white text-[15px] font-medium transition-colors hover:border-faint"
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
              <form
                onSubmit={sendCode}
                className={google ? "space-y-3" : "mt-6 space-y-3"}
              >
                <label className="block">
                  <span className="text-[13px] font-medium">Work email</span>
                  <input
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-1.5 h-11 w-full rounded-[10px] border border-line bg-white px-3.5 text-[15px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint focus:border-ink focus:shadow-[0_0_0_3px_rgb(12_14_18/0.08)]"
                  />
                </label>
                <motion.button
                  type="submit"
                  disabled={busy}
                  whileTap={{ scale: 0.98 }}
                  className="h-11 w-full rounded-[10px] bg-ink text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Sending code…" : "Continue"}
                </motion.button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="code"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={SMOOTH}
            >
              <h1 className="mt-6 font-display text-[24px] font-medium tracking-[-0.02em]">
                Check your email
              </h1>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                Enter the 6-digit code we sent to{" "}
                <span className="text-ink">{email}</span>.
              </p>
              <div className="mt-6">
                <CodeBoxes value={code} onChange={typed} disabled={busy} />
              </div>
              <div className="mt-5 flex items-center justify-between text-[13px]">
                <button
                  type="button"
                  onClick={() => {
                    setStep("email")
                    setError(null)
                  }}
                  className="text-muted transition-colors hover:text-ink"
                >
                  Use a different email
                </button>
                <button
                  type="button"
                  disabled={wait > 0 || busy}
                  onClick={() => sendCode()}
                  className="text-ink transition-colors disabled:text-faint"
                >
                  {busy
                    ? "Checking…"
                    : wait > 0
                      ? `Resend in ${wait}s`
                      : "Resend code"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden pt-4 text-[13px] text-bad"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
      <p className="mt-6 max-w-[400px] text-center text-[13px] text-muted">
        For API providers. Claiming your API never changes a rating or hides a
        review.
      </p>
    </div>
  )
}
