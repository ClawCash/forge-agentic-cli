"use client"

import { motion, useInView, useReducedMotion } from "motion/react"
import { useRef } from "react"

const EASE = [0.16, 1, 0.3, 1] as const
const AMBER = "#b8791a"

export type Mark = "failed" | "short" | "fine"

const MARK_COLOR: Record<Mark, string> = {
  failed: "var(--color-bad)",
  short: AMBER,
  fine: "var(--color-ink)",
}

// One dot per API reviewed. They fill in on scroll, problems first.
export function ApiDots({ marks }: { marks: Mark[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const reduce = !!useReducedMotion()
  return (
    <div ref={ref}>
      <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5 sm:grid-cols-[repeat(24,minmax(0,1fr))] sm:gap-2" aria-hidden="true">
        {marks.map((mark, i) => (
          <motion.span
            key={i}
            className="aspect-square rounded-full"
            style={{ background: MARK_COLOR[mark], opacity: mark === "fine" ? 0.14 : 1 }}
            initial={reduce ? false : { scale: 0, opacity: 0 }}
            animate={inView ? { scale: 1, opacity: mark === "fine" ? 0.14 : 1 } : undefined}
            transition={{ duration: 0.4, ease: EASE, delay: reduce ? 0 : i * 0.012 }}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted">
        <Legend color={MARK_COLOR.failed} label={`${marks.filter((m) => m === "failed").length} kept the payment and returned nothing usable`} />
        <Legend color={AMBER} label={`${marks.filter((m) => m === "short").length} more delivered less than their listing promised`} />
        <Legend color="var(--color-faint)" label={`${marks.filter((m) => m === "fine").length} delivered what they said`} />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

// Horizontal bars that grow to their share when they scroll into view.
export function ShareBars({
  rows,
  max = 1,
}: {
  // `shown` is the value as written beside the bar, such as "56%" or "108 calls".
  rows: { label: string; value: number; shown: string; note?: string; tone?: "bad" | "amber" | "ink" | "ok" }[]
  max?: number
}) {
  const ref = useRef<HTMLUListElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const reduce = !!useReducedMotion()
  const tone = { bad: "var(--color-bad)", amber: AMBER, ink: "var(--color-ink)", ok: "var(--color-ok)" }
  return (
    <ul ref={ref} className="grid gap-3.5">
      {rows.map((row, i) => (
        <li key={row.label} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="font-medium">{row.label}</span>
            <span className="shrink-0 font-mono text-[12.5px] text-muted">
              {row.shown}
              {row.note && <span className="ml-2 text-faint">{row.note}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-paper">
            <motion.div
              className="h-full origin-left rounded-full"
              style={{ background: tone[row.tone ?? "ink"], width: `${Math.max(1.5, (row.value / max) * 100)}%` }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={inView ? { scaleX: 1 } : undefined}
              transition={{ duration: 0.9, ease: EASE, delay: reduce ? 0 : 0.1 + i * 0.07 }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// A right pick against a wrong one: the wasted wait, then the call that works.
export function TimeToResult({ working, failed }: { working: number; failed: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduce = !!useReducedMotion()
  const total = failed + working
  const bar = (seconds: number, color: string, delay: number, label: string) => (
    <motion.div
      className="flex h-9 origin-left items-center rounded-[8px] px-2.5 text-[12px] font-medium text-white"
      style={{ background: color, width: `${(seconds / total) * 100}%` }}
      initial={reduce ? false : { scaleX: 0, opacity: 0 }}
      animate={inView ? { scaleX: 1, opacity: 1 } : undefined}
      transition={{ duration: 0.8, ease: EASE, delay: reduce ? 0 : delay }}
    >
      <span className="truncate">{label}</span>
    </motion.div>
  )
  return (
    <div ref={ref} className="grid gap-4">
      <div className="grid gap-1.5">
        <div className="text-[13px] text-muted">Right API first</div>
        <div className="flex">{bar(working, "var(--color-ok)", 0.1, `${working}s, paid once`)}</div>
      </div>
      <div className="grid gap-1.5">
        <div className="text-[13px] text-muted">Wrong API first</div>
        <div className="flex gap-1">
          {bar(failed, "var(--color-bad)", 0.3, `${failed}s lost, paid for nothing`)}
          {bar(working, "var(--color-ok)", 0.8, `${working}s, paid again`)}
        </div>
      </div>
    </div>
  )
}
