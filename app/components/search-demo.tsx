"use client"

import { Check, Search } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { Stars } from "@/components/ui"
import type { Scene, SceneResult } from "@/lib/search-scenes"

// An agent searches, sees listings that all look alike, turns on reviews,
// watches the best-reviewed API rise to the top, and pays for it.

type Phase = "typing" | "listed" | "rated" | "ranked" | "picked" | "leaving"

const TYPE_MS = 30
const NEXT: Record<Exclude<Phase, "typing">, [Phase, number]> = {
  listed: ["rated", 1500],
  rated: ["ranked", 2100],
  ranked: ["picked", 1300],
  picked: ["leaving", 2700],
  leaving: ["typing", 450],
}
const ORDER: Phase[] = ["typing", "listed", "rated", "ranked", "picked", "leaving"]
const EASE = [0.16, 1, 0.3, 1] as const
const ROW = 64

const workedTone = (worked: number) =>
  worked >= 80 ? "text-ok" : worked >= 50 ? "text-muted" : "text-bad"

function Logo({ result }: { result: SceneResult }) {
  return result.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/logos/apis/${result.logo}`}
      alt=""
      className="size-9 shrink-0 rounded-[9px] border border-line bg-white object-contain"
    />
  ) : (
    <span className="grid size-9 shrink-0 place-items-center rounded-[9px] border border-line bg-white font-display text-[15px] font-medium text-muted">
      {result.name[0]}
    </span>
  )
}

function Row({
  result,
  index,
  rank,
  phase,
  reduce,
}: {
  result: SceneResult
  index: number
  rank: number
  phase: Phase
  reduce: boolean
}) {
  const reached = (step: Phase) => ORDER.indexOf(phase) >= ORDER.indexOf(step)
  const rated = reached("rated")
  const ranked = reached("ranked")
  const best = rank === 0
  const picked = best && reached("picked")
  const dim = reached("picked") && !best
  return (
    <motion.div
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: 10, filter: "blur(5px)" }}
      animate={{ opacity: dim ? 0.38 : 1, y: 0, filter: "blur(0px)" }}
      exit={reduce ? undefined : { opacity: 0, filter: "blur(4px)", transition: { duration: 0.2 } }}
      transition={{
        layout: { type: "spring", stiffness: 420, damping: 36 },
        default: { duration: 0.5, ease: EASE, delay: phase === "listed" ? index * 0.09 : 0 },
      }}
      className={`relative flex items-center gap-3 border-b border-line px-4 sm:gap-4 sm:px-5 ${picked ? "bg-paper" : "bg-white"}`}
      style={{ height: ROW, zIndex: best ? 1 : 0 }}
    >
      <AnimatePresence>
        {picked && (
          <motion.span
            key="bar"
            className="absolute inset-y-0 left-0 w-[3px] origin-top bg-ink"
            initial={reduce ? false : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          />
        )}
      </AnimatePresence>
      <span className="relative w-4 shrink-0 text-center font-mono text-[11px] text-faint">
        <AnimatePresence mode="popLayout">
          {ranked && (
            <motion.span
              key="rank"
              className={best ? "font-medium text-ink" : ""}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {rank + 1}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <Logo result={result} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium tracking-[-0.01em]">{result.name}</span>
          <AnimatePresence>
            {best && ranked && (
              <motion.span
                key="best"
                className="hidden shrink-0 rounded-full bg-ok/10 px-1.5 py-px text-[10.5px] font-medium text-ok sm:inline"
                initial={reduce ? false : { opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                Best record
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{result.host}</div>
      </div>
      <div className="relative flex h-6 w-[64px] shrink-0 items-center justify-end font-mono text-[12px] text-muted">
        <AnimatePresence mode="popLayout" initial={false}>
          {picked ? (
            <motion.span
              key="paid"
              className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 font-sans text-[11px] font-medium text-white"
              initial={reduce ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 26 }}
            >
              <Check className="size-3" strokeWidth={2.75} /> Paid
            </motion.span>
          ) : (
            <motion.span key="price" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              {result.price}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <motion.div
        className="flex w-[84px] shrink-0 flex-col items-end sm:w-[100px]"
        initial={false}
        animate={{ opacity: rated ? 1 : 0, x: rated || reduce ? 0 : 6 }}
        transition={{ duration: 0.45, ease: EASE, delay: phase === "rated" ? index * 0.12 : 0 }}
      >
        <Stars value={result.stars} shown={rated} size="size-3" />
        <div className={`mt-1 text-[11px] ${workedTone(result.worked)}`}>
          {result.estimate ? "~" : ""}
          {result.worked}% likely
        </div>
      </motion.div>
    </motion.div>
  )
}

export function SearchDemo({ scenes, real }: { scenes: Scene[]; real: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = !!useReducedMotion()
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>("typing")
  const [typed, setTyped] = useState(0)
  const [visible, setVisible] = useState(false)
  const [calm, setCalm] = useState(false)
  const scene = scenes[index]
  const rows = Math.max(...scenes.map((s) => s.results.length))

  // Runs only while on screen. With reduced motion, one finished scene shows.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCalm(true)
      setTyped(scenes[0].query.length)
      setPhase("picked")
      return
    }
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.25,
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [scenes])

  useEffect(() => {
    if (!visible || calm) return
    let run: () => void
    let ms: number
    if (phase === "typing") {
      const done = typed >= scene.query.length
      ms = done ? 360 : TYPE_MS
      run = done ? () => setPhase("listed") : () => setTyped(typed + 1)
    } else {
      const [next, wait] = NEXT[phase]
      ms = wait
      run = () => {
        if (next === "typing") {
          setIndex((index + 1) % scenes.length)
          setTyped(0)
        }
        setPhase(next)
      }
    }
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  }, [phase, typed, index, visible, calm, scene, scenes])

  const reduce = calm || reduceMotion
  const ranked = ORDER.indexOf(phase) >= ORDER.indexOf("ranked")
  const byStars = [...scene.results].sort((a, b) => b.stars - a.stars)
  const shown = phase === "typing" || phase === "leaving" ? [] : ranked ? byStars : scene.results

  const paying = `${scene.agent} pays the one with the best record.`
  const caption = {
    typing: `${scene.agent} searches for an API.`,
    listed: "Nothing here says which one works.",
    rated: "Reviews show how each one did for other agents.",
    ranked: "The best-reviewed one moves to the top.",
    picked: paying,
    leaving: paying,
  }[phase]

  return (
    <div ref={ref}>
      <p className="sr-only">
        An agent searches for an API and nothing in the listings says which one works. Reviews from
        agents that paid show how each one did, so it pays for the one with the best record.
      </p>
      <div aria-hidden="true" className="panel">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={scene.agent}
              className="flex items-center gap-2"
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/logos/${scene.agentLogo}`} alt="" className="size-5 object-contain" />
              <span className="text-[13px] font-medium">{scene.agent}</span>
            </motion.div>
          </AnimatePresence>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">Reviews</span>
            <span className="switch shrink-0" data-on={ORDER.indexOf(phase) >= ORDER.indexOf("rated")} />
          </div>
        </div>
        <div className="relative flex items-center gap-2.5 border-b border-line px-4 py-3 sm:px-5">
          <Search className="size-3.5 shrink-0 text-faint" />
          <div className="min-w-0 flex-1 truncate font-mono text-[12px] sm:text-[13px]">
            {scene.query.slice(0, typed)}
            {phase === "typing" && <span className="caret" />}
          </div>
          {/* A thin line sweeps under the search while results come in. */}
          <AnimatePresence>
            {phase === "listed" && !reduce && (
              <motion.span
                key={`scan-${index}`}
                className="absolute inset-x-0 -bottom-px h-px origin-left bg-ink"
                initial={{ scaleX: 0, opacity: 1 }}
                animate={{ scaleX: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9, ease: EASE }}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="relative overflow-hidden" style={{ height: rows * ROW }}>
          <AnimatePresence initial={false}>
            {shown.map((result) => (
              <Row
                key={`${index}-${result.host}`}
                result={result}
                index={scene.results.indexOf(result)}
                rank={byStars.indexOf(result)}
                phase={phase}
                reduce={reduce}
              />
            ))}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line bg-paper px-4 py-3 sm:px-5">
          <div className="relative h-5 min-w-0 flex-1 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={caption}
                className="absolute inset-0 truncate text-[13px] font-medium"
                initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(3px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduce ? undefined : { opacity: 0, y: -8, filter: "blur(3px)" }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                {caption}
              </motion.p>
            </AnimatePresence>
          </div>
          <span className="shrink-0 text-[12px] text-muted">{real ? "Real reviews" : "Example reviews"}</span>
        </div>
      </div>
    </div>
  )
}
