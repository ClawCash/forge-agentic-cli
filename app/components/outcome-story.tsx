"use client"

import { Check, X, Zap } from "lucide-react"
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react"
import { useEffect, useRef, useState } from "react"
import { Mark, Stars } from "@/components/ui"

const EASE = [0.16, 1, 0.3, 1] as const
const POP = { type: "spring", stiffness: 520, damping: 26 } as const

// A number that runs up to its new value instead of jumping.
function Ticker({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = !!useReducedMotion()
  const motionValue = useMotionValue(value)
  const [text, setText] = useState(format(value))
  useMotionValueEvent(motionValue, "change", (latest) => setText(format(latest)))
  useEffect(() => {
    if (reduce) {
      motionValue.jump(value)
      setText(format(value))
      return
    }
    const controls = animate(motionValue, value, { duration: 0.5, ease: EASE })
    return () => controls.stop()
  }, [value, reduce, motionValue, format])
  return <>{text}</>
}

// One task, run twice. A scripted illustration with placeholder APIs and
// made-up figures, so it says nothing about any real seller or real saving.
interface Step {
  title: string
  detail: string
  cost?: string
  result?: "fail" | "ok"
  stars?: boolean
  // This step's share of the slower run's total: tokens, time, money.
  use: [number, number, number]
}

const WITHOUT: Step[] = [
  {
    title: "Search",
    detail: "Every listing looks the same",
    use: [16, 14, 0],
  },
  {
    title: "Pay API A",
    detail: "Empty response",
    cost: "$0.01",
    result: "fail",
    use: [20, 24, 25],
  },
  {
    title: "Pay API B",
    detail: "Data is out of date",
    cost: "$0.02",
    result: "fail",
    use: [20, 24, 50],
  },
  {
    title: "Search again",
    detail: "Back to the list",
    use: [16, 14, 0],
  },
  {
    title: "Pay API C",
    detail: "Right result",
    cost: "$0.01",
    result: "ok",
    use: [28, 24, 25],
  },
]

const WITH: Step[] = [
  {
    title: "Search",
    detail: "Every listing comes with its reviews",
    use: [12, 12, 0],
  },
  {
    title: "Check",
    detail: "API C worked on tasks like this",
    stars: true,
    use: [6, 6, 0],
  },
  {
    title: "Pay API C",
    detail: "Right result",
    cost: "$0.01",
    result: "ok",
    use: [14, 16, 25],
  },
  {
    title: "Review",
    detail: "One line for the next agent",
    use: [0, 0, 0],
  },
]

// The slower run's totals in this scripted example. Not measurements.
const METERS = [
  {
    label: "Tokens",
    total: 12_400,
    format: (n: number) =>
      n < 1000 ? String(Math.round(n)) : `${(n / 1000).toFixed(1)}k`,
  },
  {
    label: "Time",
    total: 84,
    format: (n: number) => {
      const seconds = Math.round(n)
      return seconds < 60
        ? `${seconds}s`
        : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    },
  },
  {
    label: "Money",
    total: 0.04,
    format: (n: number) => `$${n.toFixed(2)}`,
  },
]
const STEP_MS = 620
// Past the slower run's last step, so the finished result can be read.
const LAST_TICK = 11

const outcomeTick = (steps: Step[]) =>
  steps.findIndex((step) => step.result === "ok") + 1

const share = (steps: Step[], meter: number) =>
  steps.reduce((sum, step) => sum + step.use[meter], 0)

const SAVED = METERS.map((_, meter) => 100 - share(WITH, meter))
const TIMES_FASTER = Math.round(share(WITHOUT, 1) / share(WITH, 1))

function captionFor(tick: number) {
  if (tick < 1) return "Same task, same agent."
  if (tick < outcomeTick(WITH))
    return "One run guesses. The other checks first."
  if (tick < outcomeTick(WITHOUT)) {
    return "Reviews got there first. The other run is still paying."
  }
  return `In this example: ${TIMES_FASTER}x faster, ${SAVED[0]}% fewer tokens, ${SAVED[2]}% less money.`
}

function StepIcon({ step, active }: { step: Step; active: boolean }) {
  const shell = "mt-0.5 grid size-[18px] shrink-0 place-items-center"
  const state = active ? "active" : (step.result ?? "plain")
  return (
    <span className={`${shell} relative`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          className={`grid size-[18px] place-items-center rounded-full ${
            state === "fail" ? "bg-bad/10 text-bad" : state === "ok" ? "bg-ok/10 text-ok" : ""
          }`}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }}
          transition={POP}
        >
          {state === "active" && <span className="spinner" />}
          {state === "fail" && <X className="size-3" strokeWidth={2.5} />}
          {state === "ok" && <Check className="size-3" strokeWidth={2.5} />}
          {state === "plain" && <span className="size-1.5 rounded-full bg-ink" />}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function StepRow({
  step,
  hidden,
  active,
}: {
  step: Step
  hidden: boolean
  active: boolean
}) {
  return (
    <motion.li
      className={`relative -mx-2 flex h-[54px] items-start gap-3 rounded-[10px] px-2 ${
        !active && step.result === "ok" ? "bg-ok/[0.06]" : ""
      }`}
      initial={false}
      animate={
        hidden
          ? { opacity: 0, y: 8, filter: "blur(4px)", x: 0 }
          : !active && step.result === "fail"
            ? { opacity: 1, y: 0, filter: "blur(0px)", x: [0, -4, 4, -3, 3, 0] }
            : { opacity: 1, y: 0, filter: "blur(0px)", x: 0 }
      }
      transition={{
        default: { duration: 0.45, ease: EASE },
        x: { duration: 0.4, ease: "easeInOut" },
      }}
      style={{ transitionProperty: "background-color", transitionDuration: "400ms" }}
    >
      <StepIcon step={step} active={active} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] leading-[22px] font-medium">
          {step.title}
        </div>
        <div className="truncate text-[13px] leading-5 text-muted">
          {active ? "Working" : step.detail}
        </div>
      </div>
      {!active && step.stars && (
        <span className="pt-1">
          <Stars value={5} size="size-3" />
        </span>
      )}
      {!active && step.cost && (
        <span className="pt-0.5 font-mono text-[12px] text-muted">
          {step.cost}
        </span>
      )}
    </motion.li>
  )
}

function Lane({
  heading,
  steps,
  tick,
  winner,
}: {
  heading: React.ReactNode
  steps: Step[]
  tick: number
  winner?: boolean
}) {
  const done = tick >= outcomeTick(steps)
  const bothDone = tick >= outcomeTick(WITHOUT)
  const used = METERS.map((_, meter) =>
    steps.reduce((sum, step, i) => sum + (i <= tick ? step.use[meter] : 0), 0)
  )
  return (
    <div
      className={`p-5 transition-[background-color,opacity] duration-300 sm:p-6 ${
        winner && done ? "bg-ok/[0.05]" : ""
      } ${!winner && bothDone ? "opacity-55" : ""}`}
    >
      <div className="flex h-6 items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          {heading}
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          {winner && bothDone ? (
            <motion.span
              key="faster"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ok px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap text-white"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={POP}
            >
              <Zap className="size-3" strokeWidth={2.5} />
              {TIMES_FASTER}x faster
            </motion.span>
          ) : done ? (
            <motion.span
              key="done"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[12px] font-medium whitespace-nowrap text-ok"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={POP}
            >
              <Check className="size-3" strokeWidth={2.5} />
              <span className="sm:hidden">Done</span>
              <span className="hidden sm:inline">Outcome reached</span>
            </motion.span>
          ) : (
            tick >= 0 && (
              <motion.span
                key="running"
                className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-muted"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className="live-dot !bg-ink after:!bg-ink" aria-hidden="true" />
                Running
              </motion.span>
            )
          )}
        </AnimatePresence>
      </div>
      {/* How far this run is toward the outcome. */}
      <div className="mt-3 h-[2px] overflow-hidden rounded-full bg-paper">
        <motion.div
          className={`h-full origin-left rounded-full ${winner ? "bg-ok" : "bg-faint"}`}
          initial={false}
          animate={{
            scaleX: Math.min(1, Math.max(0, (Math.min(tick, outcomeTick(steps) - 1) + 1) / outcomeTick(steps))),
          }}
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        />
      </div>
      <ol className="mt-4 h-[270px]">
        {steps.map((step, i) => (
          <StepRow
            key={step.title}
            step={step}
            hidden={tick < i}
            active={tick === i}
          />
        ))}
      </ol>
      <dl className="space-y-2.5 border-t border-line pt-5">
        {METERS.map(({ label, total, format }, i) => (
          <div key={label} className="flex items-center gap-3">
            <dt className="w-12 shrink-0 text-[12px] text-muted">{label}</dt>
            <dd className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper">
              <motion.div
                className={`h-full origin-left rounded-full transition-colors duration-300 ${
                  winner ? (done ? "bg-ok" : "bg-ink") : "bg-faint"
                }`}
                initial={false}
                animate={{ scaleX: used[i] / 100 }}
                transition={{ type: "spring", stiffness: 140, damping: 24 }}
              />
            </dd>
            <dd className="w-[50px] shrink-0 text-right font-mono text-[12px] font-medium tabular-nums">
              <Ticker value={(used[i] / 100) * total} format={format} />
            </dd>
            <dd className="w-9 shrink-0 text-right text-[12px] font-medium text-ok tabular-nums">
              <AnimatePresence>
                {winner && bothDone && (
                  <motion.span
                    key="saved"
                    className="inline-block"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease: EASE, delay: i * 0.08 }}
                  >
                    -{SAVED[i]}%
                  </motion.span>
                )}
              </AnimatePresence>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function OutcomeStory() {
  const ref = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(-1)
  const [visible, setVisible] = useState(false)
  const [calm, setCalm] = useState(false)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCalm(true)
      setTick(LAST_TICK)
      return
    }
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.3 }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || calm) return
    const timer = setTimeout(
      () => setTick((t) => (t >= LAST_TICK ? -1 : t + 1)),
      STEP_MS
    )
    return () => clearTimeout(timer)
  }, [tick, visible, calm])

  const caption = captionFor(tick)
  return (
    <div ref={ref}>
      <p className="sr-only">
        An illustration of one task run twice. Without reviews, the agent pays
        two APIs that fail and searches again before it reaches the outcome.
        With reviews, it checks first, pays the API that works and reaches the
        same outcome about three times faster, with about a third of the tokens
        and a quarter of the money. These figures are illustrative.
      </p>
      <div aria-hidden="true" className="panel">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3.5 sm:px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/claudecode.svg" alt="" className="size-5" />
          <span className="text-[13px] font-medium">Claude Code</span>
          <span className="font-mono text-[12px] text-muted">
            find the work email for a head of sales
          </span>
          <span className="label ml-auto text-[10px] text-faint">
            Illustrative
          </span>
        </div>
        <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
          <Lane
            heading={<span className="text-muted">Without reviews</span>}
            steps={WITHOUT}
            tick={tick}
          />
          <Lane
            heading={
              <>
                <Mark className="size-4" />
                With 402reviews
              </>
            }
            steps={WITH}
            tick={tick}
            winner
          />
        </div>
        <div className="relative h-[50px] overflow-hidden border-t border-line bg-paper px-5 sm:px-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={caption}
              className="absolute inset-x-5 inset-y-0 flex items-center text-[14px] font-medium sm:inset-x-6"
              initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(3px)" }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {caption}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
