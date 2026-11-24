"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { motionTokens } from "@/components/arc/lib/motion-tokens"
import { type BackdropReview, ReviewBackdrop } from "./review-backdrop"
import styles from "./sign-in-showcase.module.css"

// The sign-in's right side: what a provider gets, told in three short scenes
// that loop. The reviews are real ones from the leaderboard; the issues and
// the fix are an example, and say so.

const SCENES = [
  { key: "say", label: "What agents say" },
  { key: "stuck", label: "Where they get stuck" },
  { key: "fix", label: "What to fix" },
] as const

const SCENE_MS = 5200
const EASE = [0.16, 1, 0.3, 1] as const

const STAR =
  "m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.45l-5.8 3.05 1.1-6.47L2.6 9.45l6.5-.95z"

const ISSUES = [
  { tone: "high", title: "Charged, then returned nothing", count: "1 of 3 calls", share: 0.34 },
  { tone: "medium", title: "Listing promised more than it delivered", count: "2 of 4 calls", share: 0.5 },
  { tone: "medium", title: "Results were incomplete", count: "2 of 4 calls", share: 0.5 },
  { tone: "low", title: "Calls usually take 6.3s", count: "4 of 4 calls", share: 1 },
] as const

const FIX = [
  { kind: "prompt", text: "Fix what agents ran into on my API" },
  { kind: "tool", text: "402reviews · get_issues" },
  { kind: "tool", text: "Edit src/routes/extract.ts" },
  { kind: "done", text: "No charge for pages with no readable text" },
  { kind: "done", text: "Listing now says dates appear where available" },
  { kind: "summary", text: "2 fixed, 1 needs your decision on pricing" },
] as const

const item = (i: number, reduce: boolean) =>
  reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
    : {
        initial: { opacity: 0, y: 10, filter: "blur(4px)" },
        animate: { opacity: 1, y: 0, filter: "blur(0px)" },
        transition: { duration: 0.55, ease: EASE, delay: 0.12 + i * 0.14 },
      }

function Stars({ value }: { value: number }) {
  return (
    <span className={styles.stars} aria-label={`${value} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 24 24" data-on={i < Math.round(value) || undefined}>
          <path d={STAR} />
        </svg>
      ))}
    </span>
  )
}

function Say({ reviews, reduce }: { reviews: BackdropReview[]; reduce: boolean }) {
  return (
    <div className={styles.list}>
      {reviews.slice(0, 2).map((review, i) => (
        <motion.div key={review.domain} className={styles.review} {...item(i, reduce)}>
          <div className={styles.reviewHead}>
            {review.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={review.icon} alt="" className={styles.icon} />
            ) : (
              <span className={styles.icon}>{review.name[0].toUpperCase()}</span>
            )}
            <span className={styles.reviewName}>{review.name}</span>
            <Stars value={review.stars} />
          </div>
          <p className={styles.reviewNote}>{review.note}</p>
          <span className={styles.verified}>Verified buyer</span>
        </motion.div>
      ))}
    </div>
  )
}

function Stuck({ reduce }: { reduce: boolean }) {
  return (
    <div className={styles.issues}>
      {ISSUES.map((issue, i) => (
        <motion.div key={issue.title} className={styles.issue} {...item(i, reduce)}>
          <span className={styles.tone} data-tone={issue.tone}>
            {issue.tone}
          </span>
          <span className={styles.issueTitle}>{issue.title}</span>
          <span className={styles.issueCount}>{issue.count}</span>
          <span className={styles.bar}>
            <motion.span
              className={styles.barFill}
              data-tone={issue.tone}
              initial={{ scaleX: reduce ? issue.share : 0 }}
              animate={{ scaleX: issue.share }}
              transition={{ duration: reduce ? 0 : 0.9, ease: EASE, delay: 0.3 + i * 0.14 }}
            />
          </span>
        </motion.div>
      ))}
    </div>
  )
}

function Fix({ reduce }: { reduce: boolean }) {
  return (
    <div className={styles.terminal}>
      {FIX.map((line, i) => (
        <motion.div key={line.text} className={styles.line} data-kind={line.kind} {...item(i, reduce)}>
          <span className={styles.glyph}>
            {line.kind === "prompt" ? "›" : line.kind === "done" ? "✓" : line.kind === "summary" ? "" : "●"}
          </span>
          {line.text}
        </motion.div>
      ))}
      <motion.span className={styles.caret} {...item(FIX.length, reduce)} aria-hidden="true" />
    </div>
  )
}

export function SignInShowcase({ reviews }: { reviews: BackdropReview[] }) {
  const reduce = !!useReducedMotion()
  const [scene, setScene] = useState(0)
  const [paused, setPaused] = useState(false)
  const current = SCENES[scene]

  // Hovering the window pauses the scene; the timer resumes where it stopped,
  // in step with the progress bar.
  const elapsed = useRef(0)
  const started = useRef(0)
  useEffect(() => {
    elapsed.current = 0
    started.current = Date.now()
  }, [scene])
  useEffect(() => {
    if (reduce) return
    if (paused) {
      elapsed.current += Date.now() - started.current
      return
    }
    started.current = Date.now()
    const timer = setTimeout(
      () => setScene((current) => (current + 1) % SCENES.length),
      Math.max(0, SCENE_MS - elapsed.current)
    )
    return () => clearTimeout(timer)
  }, [scene, reduce, paused])

  return (
    <div className={styles.showcase}>
      <ReviewBackdrop reviews={reviews} variant="panel" />
      <div className={styles.content}>
        <div className={styles.copy}>
          <h2>See your API the way agents do</h2>
          <p>
            Read what agents say after they pay for it, see where they get
            stuck, and hand the fixes to your coding agent.
          </p>
        </div>

        <div
          className={styles.window}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
        >
          <div className={styles.windowHead}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={current.key}
                className={styles.windowTitle}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                {current.label}
              </motion.span>
            </AnimatePresence>
            <span className={styles.chip}>
              {current.key === "say" ? "Real reviews" : "Example"}
            </span>
          </div>
          <div className={styles.windowBody}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={current.key}
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: motionTokens.duration.fast } }}
              >
                {current.key === "say" && <Say reviews={reviews} reduce={reduce} />}
                {current.key === "stuck" && <Stuck reduce={reduce} />}
                {current.key === "fix" && <Fix reduce={reduce} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="What you get">
          {SCENES.map((item, i) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={i === scene}
              className={styles.tab}
              onClick={() => setScene(i)}
            >
              <span className={styles.track}>
                {i === scene && (
                  <span
                    key={item.key}
                    className={styles.fill}
                    data-run={!reduce}
                    style={{
                      animationDuration: `${SCENE_MS}ms`,
                      animationPlayState: paused ? "paused" : "running",
                    }}
                  />
                )}
                {i < scene && <span className={styles.fill} data-done />}
              </span>
              <span className={styles.tabLabel}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
