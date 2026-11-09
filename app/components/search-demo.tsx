"use client"

import { Check, Search } from "lucide-react"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Star, Stars } from "@/components/ui"

// A scripted, clearly labelled example: the same search with and without
// reviews. The cheapest listing looks best until reviews show it rarely works.
const QUERY = "search the web for today's news"

const RESULTS = [
  {
    host: "alpha.example",
    price: "$0.003",
    stars: 0.8,
    worked: 15,
    verdict: "Avoid",
    reviews: 31,
    listed: 0,
    ranked: 2,
  },
  {
    host: "charlie.example",
    price: "$0.008",
    stars: 2.8,
    worked: 55,
    verdict: "Caution",
    reviews: 9,
    listed: 1,
    ranked: 1,
  },
  {
    host: "bravo.example",
    price: "$0.010",
    stars: 4.7,
    worked: 94,
    verdict: "Use",
    reviews: 14,
    listed: 2,
    ranked: 0,
  },
]

const VERDICT_STYLE: Record<string, string> = {
  Use: "bg-ok/10 text-ok",
  Caution: "bg-accent-soft text-accent",
  Avoid: "bg-bad/10 text-bad",
}

const STEPS = [
  { phase: "typing", ms: 1700, caption: "Your agent searches for an API." },
  { phase: "listed", ms: 2000, caption: "Every result looks the same." },
  { phase: "rated", ms: 2300, caption: "Now it sees how each one did." },
  { phase: "ranked", ms: 2000, caption: "The one that works moves up." },
  { phase: "picked", ms: 2200, caption: "It pays with your wallet." },
  {
    phase: "reviewed",
    ms: 3000,
    caption: "Then leaves a review for the next agent.",
  },
]

const BURST = [
  ["-30px", "-22px"],
  ["-8px", "-30px"],
  ["18px", "-26px"],
  ["34px", "-8px"],
  ["-38px", "2px"],
]

export function SearchDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [typed, setTyped] = useState(0)
  const [visible, setVisible] = useState(false)
  const [calm, setCalm] = useState(false)

  // Runs only while on screen. With reduced motion, shows the final state.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCalm(true)
      setStep(STEPS.length - 1)
      setTyped(QUERY.length)
      return
    }
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.25 }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || calm) return
    const timer = setTimeout(
      () => setStep((current) => (current + 1) % STEPS.length),
      STEPS[step].ms
    )
    return () => clearTimeout(timer)
  }, [step, visible, calm])

  useEffect(() => {
    if (!visible || calm || step !== 0) return
    setTyped(0)
    const timer = setInterval(
      () => setTyped((n) => Math.min(n + 1, QUERY.length)),
      36
    )
    return () => clearInterval(timer)
  }, [step, visible, calm])

  const from = (phase: string) =>
    step >= STEPS.findIndex((s) => s.phase === phase)

  return (
    <div ref={ref}>
      <p className="sr-only">
        Example: an agent searches for a web search API. Without reviews, three
        listings look the same. With reviews, the cheapest one turns out to work
        15% of the time, so the agent pays for the one that worked 94% of the
        time and leaves a review.
      </p>
      <div
        aria-hidden="true"
        className="mx-auto max-w-[780px] overflow-hidden rounded-[14px] border border-ink bg-white shadow-[5px_6px_0_0_#141414]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <Search className="size-4 shrink-0 text-muted" />
          <div className="min-w-0 flex-1 truncate font-mono text-[12px] sm:text-[13px]">
            {QUERY.slice(0, typed)}
            {step === 0 && <span className="caret" />}
          </div>
          <span className="label hidden text-[10px] sm:inline">Reviews</span>
          <span className="switch shrink-0" data-on={from("rated")} />
        </div>

        <div
          className="relative [--row:76px]"
          style={{ height: `calc(${RESULTS.length} * var(--row))` }}
        >
          {RESULTS.map((result) => {
            const place = from("ranked") ? result.ranked : result.listed
            const best = result.ranked === 0
            const worst = result.ranked === RESULTS.length - 1
            const picked = best && from("picked")
            const reviewed = best && from("reviewed")
            const dim = from("picked") && !best
            return (
              <div
                key={result.host}
                className="demo-row absolute inset-x-0 top-0 flex items-center gap-3 border-b border-line px-4 last:border-b-0 sm:gap-5 sm:px-5"
                style={{
                  transform: `translateY(calc(${place} * var(--row)))`,
                  opacity: from("listed") ? (dim ? 0.4 : 1) : 0,
                  transitionDelay:
                    step === 1 ? `${result.listed * 110}ms` : "0ms",
                }}
              >
                {picked && (
                  <span className="picked-ring absolute inset-1.5 rounded-[9px] border-[1.5px] border-accent bg-accent-soft/60" />
                )}
                <div className="relative min-w-0 flex-1">
                  <div className="truncate font-mono text-[12px] font-medium sm:text-[13px]">
                    {result.host}
                    <span className="hidden text-faint sm:inline">/search</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted sm:hidden">
                    {result.price}
                  </div>
                  <div className="mt-1 hidden truncate text-[12px] text-muted sm:block">
                    Fast, accurate web search.
                  </div>
                </div>
                <div className="relative hidden w-14 font-mono text-[12px] text-muted sm:block">
                  {result.price}
                </div>
                <div
                  className="relative w-[92px] transition-opacity duration-500 sm:w-[150px]"
                  style={{ opacity: from("rated") ? 1 : 0 }}
                >
                  <Stars value={result.stars} shown={from("rated")} />
                  <div className="mt-1 font-mono text-[10.5px] text-muted">
                    {result.worked}% worked
                    <span className="hidden sm:inline">
                      {" · "}
                      {result.reviews + (reviewed ? 1 : 0)} reviews
                    </span>
                  </div>
                  {reviewed && (
                    <>
                      <span className="plus-one absolute -top-3 right-1 font-mono text-[12px] font-semibold text-accent">
                        +1
                      </span>
                      {BURST.map(([x, y], i) => (
                        <span
                          key={i}
                          className="burst-star text-accent"
                          style={
                            {
                              "--x": x,
                              "--y": y,
                              "--d": `${i * 40}ms`,
                            } as CSSProperties
                          }
                        >
                          <Star className="size-2.5" />
                        </span>
                      ))}
                    </>
                  )}
                </div>
                <div className="relative w-[62px] text-right">
                  {from("rated") && (
                    <span
                      key={picked ? "paid" : "verdict"}
                      className={`chip-in inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
                        picked
                          ? "bg-accent text-white"
                          : VERDICT_STYLE[result.verdict]
                      }`}
                      style={{
                        animationDelay:
                          step === 2
                            ? `${worst ? 500 : best ? 100 : 300}ms`
                            : "0ms",
                      }}
                    >
                      {picked ? (
                        <>
                          <Check className="size-3" /> Paid
                        </>
                      ) : (
                        result.verdict
                      )}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line bg-paper px-4 py-3 sm:px-5">
          <p key={step} className="caption text-[13px] font-medium">
            {STEPS[step].caption}
          </p>
          <span className="label shrink-0 text-[10px] text-faint">Example</span>
        </div>
      </div>
    </div>
  )
}
