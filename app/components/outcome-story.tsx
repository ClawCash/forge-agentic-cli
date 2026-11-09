"use client"

import { Check, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Mark, Stars } from "@/components/ui"

// One task, run twice. A scripted illustration with placeholder APIs, so it
// says nothing about any real seller and claims no measured saving.
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

const METERS = ["Tokens", "Time", "Money"]
const STEP_MS = 1250
// Past the slower run's last step, so the finished result can be read.
const LAST_TICK = 9

const outcomeTick = (steps: Step[]) =>
  steps.findIndex((step) => step.result === "ok") + 1

function captionFor(tick: number) {
  if (tick < 1) return "Same task, same agent."
  if (tick < outcomeTick(WITH))
    return "One run guesses. The other checks first."
  if (tick < outcomeTick(WITHOUT)) {
    return "Reviews got there first. The other run is still paying."
  }
  return "Same outcome. Fewer tokens, less time, less money."
}

function StepIcon({ step, active }: { step: Step; active: boolean }) {
  const shell = "mt-0.5 grid size-[18px] shrink-0 place-items-center"
  if (active) {
    return (
      <span className={shell}>
        <span className="spinner" />
      </span>
    )
  }
  if (step.result === "fail") {
    return (
      <span className={`${shell} rounded-full bg-bad/10 text-bad`}>
        <X className="size-3" strokeWidth={2.5} />
      </span>
    )
  }
  if (step.result === "ok") {
    return (
      <span className={`${shell} rounded-full bg-ok/10 text-ok`}>
        <Check className="size-3" strokeWidth={2.5} />
      </span>
    )
  }
  return (
    <span className={shell}>
      <span className="size-1.5 rounded-full bg-ink" />
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
    <li
      className="flex h-[54px] items-start gap-3 transition-[opacity,transform] duration-300"
      style={{
        opacity: hidden ? 0 : 1,
        transform: hidden ? "translateY(4px)" : "none",
      }}
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
    </li>
  )
}

function Lane({
  heading,
  steps,
  tick,
  strong,
}: {
  heading: React.ReactNode
  steps: Step[]
  tick: number
  strong?: boolean
}) {
  const done = tick >= outcomeTick(steps)
  const used = METERS.map((_, meter) =>
    steps.reduce((sum, step, i) => sum + (i <= tick ? step.use[meter] : 0), 0)
  )
  return (
    <div className="p-5 sm:p-6">
      <div className="flex h-6 items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          {heading}
        </div>
        {done && (
          <span className="caption inline-flex shrink-0 items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[12px] font-medium whitespace-nowrap text-ok">
            <Check className="size-3" strokeWidth={2.5} />
            <span className="sm:hidden">Done</span>
            <span className="hidden sm:inline">Outcome reached</span>
          </span>
        )}
      </div>
      <ol className="mt-5 h-[270px]">
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
        {METERS.map((label, i) => (
          <div key={label} className="flex items-center gap-3">
            <dt className="w-14 shrink-0 text-[12px] text-muted">{label}</dt>
            <dd className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper">
              <div
                className={`meter h-full rounded-full ${strong ? "bg-ink" : "bg-faint"}`}
                style={{ width: `${used[i]}%` }}
              />
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
        same outcome with fewer tokens, less time and less money.
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
                With Agent Reviews
              </>
            }
            steps={WITH}
            tick={tick}
            strong
          />
        </div>
        <div className="border-t border-line bg-paper px-5 py-3.5 sm:px-6">
          <p key={caption} className="caption text-[14px] font-medium">
            {caption}
          </p>
        </div>
      </div>
    </div>
  )
}
