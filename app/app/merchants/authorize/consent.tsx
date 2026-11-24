"use client"

import { Check, CircleCheck, Globe, X } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useState } from "react"
import { Button } from "@/components/arc/button/button"
import { motionTokens } from "@/components/arc/lib/motion-tokens"
import { ReviewsMark } from "@/components/merchant/shell"
import { act } from "../act"
import { AppIcon, iconFor } from "../connect-view"
import styles from "./consent.module.css"

const CAN = [
  "Read reviews and what agents ran into on your verified APIs",
  "See ratings, speed and your seeding requests",
]
const CANNOT = "It can't change anything, post reviews or see anyone else's APIs."

function Frame({ children }: { children: React.ReactNode }) {
  const reduce = !!useReducedMotion()
  return (
    <main className={styles.screen}>
      <a href="https://402reviews.xyz" className={styles.brand} aria-label="402reviews home">
        <span className={styles.mark}>
          <ReviewsMark />
        </span>
        <span className={styles.wordmark}>402reviews</span>
      </a>
      <motion.section
        className={styles.card}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
      >
        {children}
      </motion.section>
    </main>
  )
}

export function InvalidRequest() {
  return (
    <Frame>
      <div className={styles.heading}>
        <h1>This sign-in link isn&apos;t valid</h1>
        <p>
          It may be old or incomplete. Go back to your app and connect 402reviews again, or follow
          the steps on your dashboard.
        </p>
      </div>
      <a href="/merchants?view=connect" className={styles.textLink}>
        Open the setup steps
      </a>
    </Frame>
  )
}

export function Consent({
  app,
  email,
  domains,
  request,
}: {
  app: string
  email: string
  domains: string[]
  request: Record<string, string>
}) {
  const reduce = !!useReducedMotion()
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const known = iconFor(app)

  async function allow() {
    setBusy("allow")
    setError(null)
    const { ok, data } = await act("oauth_approve", "", request)
    if (!ok || typeof data.redirect !== "string") {
      setBusy(null)
      setError(String(data.error ?? "Couldn't connect. Try again."))
      return
    }
    setDone(true)
    window.location.href = data.redirect
  }

  // Tells the app the provider said no, as OAuth expects.
  function deny() {
    setBusy("deny")
    const back = new URL(request.redirect_uri)
    back.searchParams.set("error", "access_denied")
    if (request.state) back.searchParams.set("state", request.state)
    window.location.href = back.toString()
  }

  return (
    <Frame>
      <div className={styles.pair} aria-hidden="true">
        <span className={styles.tile}>
          {known ? <AppIcon app={known} size={26} /> : <span className={styles.initial}>{app[0]?.toUpperCase()}</span>}
        </span>
        <span className={styles.link}>
          <motion.span
            className={styles.pulse}
            animate={reduce || done ? undefined : { x: ["-110%", "110%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </span>
        <span className={styles.tile}>
          <ReviewsMark />
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div
            key="done"
            className={styles.done}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
          >
            <CircleCheck size={22} strokeWidth={1.75} aria-hidden="true" />
            <div className={styles.heading}>
              <h1>{app} is connected</h1>
              <p>You can close this tab and go back to {app}. Ask it what agents ran into on your APIs.</p>
            </div>
          </motion.div>
        ) : (
          <motion.div key="ask" className={styles.ask} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            <div className={styles.heading}>
              <h1>Connect {app} to 402reviews</h1>
              <p>
                {app} is asking to read the feedback on your APIs so it can help you fix what agents
                ran into.
              </p>
            </div>

            <ul className={styles.can}>
              {CAN.map((line) => (
                <li key={line}>
                  <Check size={15} strokeWidth={2} aria-hidden="true" />
                  {line}
                </li>
              ))}
              <li className={styles.cannot}>
                <X size={15} strokeWidth={2} aria-hidden="true" />
                {CANNOT}
              </li>
            </ul>

            <div className={styles.apis}>
              <span className={styles.label}>Your verified APIs</span>
              {domains.length ? (
                <ul>
                  {domains.map((domain) => (
                    <li key={domain}>
                      <Globe size={13} strokeWidth={1.75} aria-hidden="true" />
                      {domain}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>None yet. {app} sees each API once you verify it.</p>
              )}
            </div>

            <div className={styles.account}>
              <span>
                Signed in as <strong>{email}</strong>
              </span>
              <form action="/merchants/logout" method="post">
                <button type="submit" className={styles.textButton}>
                  Not you?
                </button>
              </form>
            </div>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={deny} loading={busy === "deny"} disabled={busy === "allow"}>
                Cancel
              </Button>
              <Button onClick={allow} loading={busy === "allow"} disabled={busy === "deny"}>
                Allow
              </Button>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <p className={styles.fine}>
              You can disconnect {app} any time under Connect your agent on your dashboard.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Frame>
  )
}
