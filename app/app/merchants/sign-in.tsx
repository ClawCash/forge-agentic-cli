"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import buttonStyles from "@/components/arc/button/button.module.css"
import { Button } from "@/components/arc/button/button"
import { Input } from "@/components/arc/input/input"
import { motionTokens } from "@/components/arc/lib/motion-tokens"
import { OtpInput } from "@/components/arc/otp-input/otp-input"
import { ReviewsMark } from "@/components/merchant/shell"
import styles from "./sign-in.module.css"

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
  return { ok: !!res?.ok, data }
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

export function SignIn({
  google = false,
  googleFailed = false,
  backdrop,
}: {
  google?: boolean
  googleFailed?: boolean
  backdrop?: ReactNode
}) {
  const reduce = !!useReducedMotion()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"email" | "code">("email")
  const [emailError, setEmailError] = useState<string | undefined>(
    googleFailed
      ? "Google sign-in didn't finish. Try again, or use your email."
      : undefined
  )
  const [codeError, setCodeError] = useState<string | undefined>()
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
    setEmailError(undefined)
    setCodeError(undefined)
    const { ok, data } = await post("/merchants/start", { email })
    setBusy(false)
    if (!ok) {
      const message = String(data.error ?? "Couldn't send a code. Try again.")
      if (step === "code") setCodeError(message)
      else setEmailError(message)
      return
    }
    setStep("code")
    setCode("")
    setWait(RESEND_SECONDS)
  }

  async function verify(full: string) {
    setBusy(true)
    setCodeError(undefined)
    const { ok, data } = await post("/merchants/verify", { email, code: full })
    if (ok) {
      window.location.reload()
      return
    }
    setBusy(false)
    setCode("")
    setCodeError(String(data.error ?? "That code didn't work. Try again."))
  }

  function typed(next: string) {
    setCode(next)
    setCodeError(undefined)
    if (next.length === 6 && !busy) void verify(next)
  }

  const direction = step === "code" ? 1 : -1
  const slide = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 24 * direction },
        animate: { opacity: 1, x: 0 },
        exit: {
          opacity: 0,
          x: -24 * direction,
          transition: { duration: motionTokens.duration.fast },
        },
      }

  return (
    <main className={styles.screen}>
      {backdrop}
      <div className={styles.center}>
      <motion.div
        className={styles.card}
        layout={!reduce}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
      >
        <motion.a
          layout={!reduce ? "position" : false}
          href="https://402reviews.xyz"
          className={styles.brand}
          aria-label="402reviews home"
        >
          <span className={styles.mark}>
            <ReviewsMark />
          </span>
          <span className={styles.wordmark}>402reviews</span>
          <span className={styles.tag}>for API providers</span>
        </motion.a>
        <AnimatePresence mode="popLayout" initial={false}>
          {step === "email" ? (
            <motion.div
              key="email"
              className={styles.step}
              {...slide}
              transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
            >
              <div className={styles.heading}>
                <h1>Welcome</h1>
                <p>
                  Sign in, or create an account with your work email. Then
                  claim your API and see every review agents leave.
                </p>
              </div>
              {google && (
                <>
                  <a
                    href="/merchants/google"
                    className={[buttonStyles.button, buttonStyles.secondary, buttonStyles.lg, styles.full].join(" ")}
                  >
                    <GoogleMark />
                    Continue with Google
                  </a>
                  <div className={styles.or} aria-hidden="true">
                    <span />
                    or
                    <span />
                  </div>
                </>
              )}
              <form onSubmit={sendCode} className={styles.form}>
                <Input
                  label="Work email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setEmailError(undefined)
                  }}
                  error={emailError}
                />
                <Button type="submit" size="lg" loading={busy} className={styles.full}>
                  Continue
                </Button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="code"
              className={styles.step}
              {...slide}
              transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
            >
              <div className={styles.heading}>
                <h1>Check your email</h1>
                <p>
                  We sent a 6-digit code to <strong>{email}</strong>. It works
                  for 10 minutes.
                </p>
              </div>
              <OtpInput
                label="Code"
                value={code}
                onChange={typed}
                error={codeError}
                disabled={busy}
                autoFocus
              />
              <div className={styles.links}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep("email")
                    setCodeError(undefined)
                  }}
                >
                  Use a different email
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={wait > 0 || busy}
                  onClick={() => sendCode()}
                >
                  {busy ? "Checking" : wait > 0 ? `Resend in ${wait}s` : "Resend code"}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <p className={styles.note}>
        Claiming your API never changes a rating or hides a review.
      </p>
      </div>
    </main>
  )
}
