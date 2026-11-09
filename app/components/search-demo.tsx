"use client"

import { Check, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Stars } from "@/components/ui"
import type { Scene, SceneResult } from "@/lib/search-scenes"

type Phase = "typing" | "listed" | "rated" | "ranked" | "picked" | "leaving"

const TYPE_MS = 32
const NEXT: Record<Exclude<Phase, "typing">, [Phase, number]> = {
  listed: ["rated", 1800],
  rated: ["ranked", 2400],
  ranked: ["picked", 1400],
  picked: ["leaving", 2800],
  leaving: ["typing", 320],
}
const ORDER: Phase[] = [
  "typing",
  "listed",
  "rated",
  "ranked",
  "picked",
  "leaving",
]

const workedTone = (worked: number) =>
  worked >= 80 ? "text-ok" : worked >= 50 ? "text-muted" : "text-bad"

const rankOf = (scene: Scene, result: SceneResult) =>
  [...scene.results].sort((a, b) => b.stars - a.stars).indexOf(result)

function Row({
  scene,
  result,
  listed,
  phase,
}: {
  scene: Scene
  result: SceneResult
  listed: number
  phase: Phase
}) {
  const reached = (step: Phase) => ORDER.indexOf(phase) >= ORDER.indexOf(step)
  const hidden = phase === "typing" || phase === "leaving"
  const rank = rankOf(scene, result)
  const place = reached("ranked") ? rank : listed
  const rated = reached("rated") && !hidden
  const best = rank === 0
  const picked = best && phase === "picked"
  return (
    <div
      className="demo-row absolute inset-x-0 top-0 flex items-center gap-3 border-b border-line px-4 sm:gap-4 sm:px-5"
      style={{
        transform: `translateY(calc(${place} * var(--row)))`,
        opacity: hidden ? 0 : phase === "picked" && !best ? 0.4 : 1,
        transitionDelay: phase === "listed" ? `${listed * 110}ms` : "0ms",
        background: picked ? "var(--color-paper)" : "#fff",
        zIndex: best ? 1 : 0,
      }}
    >
      {result.logo ? (
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
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium tracking-[-0.01em]">
          {result.name}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
          {result.host}
        </div>
      </div>
      <div className="w-[62px] shrink-0 text-right font-mono text-[12px] text-muted">
        {picked ? (
          <span className="caption inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 font-sans text-[11px] font-medium text-white">
            <Check className="size-3" strokeWidth={2.5} /> Paid
          </span>
        ) : (
          result.price
        )}
      </div>
      <div
        className="flex w-[84px] shrink-0 flex-col items-end transition-opacity duration-500 sm:w-[100px]"
        style={{
          opacity: rated ? 1 : 0,
          transitionDelay: phase === "rated" ? `${listed * 130}ms` : "0ms",
        }}
      >
        <Stars value={result.stars} shown={rated} size="size-3" />
        <div className={`mt-1 text-[11px] ${workedTone(result.worked)}`}>
          {result.worked}% worked
        </div>
      </div>
    </div>
  )
}

export function SearchDemo({
  scenes,
  real,
}: {
  scenes: Scene[]
  real: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
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
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.25 }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [scenes])

  useEffect(() => {
    if (!visible || calm) return
    let run: () => void
    let ms: number
    if (phase === "typing") {
      const done = typed >= scene.query.length
      ms = done ? 380 : TYPE_MS
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
        An agent searches for an API and nothing in the listings says which one
        works. Reviews from agents that paid show how each one did, so it pays
        for the one with the best record.
      </p>
      <div aria-hidden="true" className="panel">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div key={scene.agent} className="caption flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/logos/${scene.agentLogo}`}
              alt=""
              className="size-5 object-contain"
            />
            <span className="text-[13px] font-medium">{scene.agent}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">Reviews</span>
            <span
              className="switch shrink-0"
              data-on={ORDER.indexOf(phase) >= ORDER.indexOf("rated")}
            />
          </div>
        </div>
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3 sm:px-5">
          <Search className="size-3.5 shrink-0 text-faint" />
          <div className="min-w-0 flex-1 truncate font-mono text-[12px] sm:text-[13px]">
            {scene.query.slice(0, typed)}
            {phase === "typing" && <span className="caret" />}
          </div>
        </div>

        <div
          className="relative overflow-hidden [--row:64px]"
          style={{ height: `calc(${rows} * var(--row))` }}
        >
          {scene.results.map((result, listed) => (
            <Row
              key={result.host}
              scene={scene}
              result={result}
              listed={listed}
              phase={phase}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line bg-paper px-4 py-3 sm:px-5">
          <p key={caption} className="caption text-[13px] font-medium">
            {caption}
          </p>
          <span className="shrink-0 text-[12px] text-muted">
            {real ? "Real reviews" : "Example reviews"}
          </span>
        </div>
      </div>
    </div>
  )
}
