"use client"

import { Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Stars } from "@/components/ui"
import type { Scene, SceneResult } from "@/lib/search-scenes"

type Phase = "typing" | "listed" | "rated" | "leaving"

const TYPE_MS = 34
const PAUSE_MS: Record<Exclude<Phase, "typing">, number> = {
  listed: 1900,
  rated: 3400,
  leaving: 320,
}

const isRated = (result: SceneResult) => result.rating?.stars != null

function Rating({
  result,
  shown,
  order,
}: {
  result: SceneResult
  shown: boolean
  order: number
}) {
  const { rating } = result
  return (
    <div
      className="flex w-[104px] shrink-0 flex-col items-end transition-opacity duration-500 sm:w-[150px]"
      style={{
        opacity: shown ? 1 : 0,
        transitionDelay: shown ? `${order * 130}ms` : "0ms",
      }}
    >
      {rating && rating.stars !== null && rating.worked !== null ? (
        <>
          <Stars value={rating.stars} shown={shown} />
          <div className="mt-1 font-mono text-[10.5px] text-muted">
            {Math.round(rating.worked * 100)}% worked
            <span className="hidden sm:inline">
              {` · ${rating.buyers} ${rating.buyers === 1 ? "buyer" : "buyers"}`}
            </span>
          </div>
        </>
      ) : (
        rating && (
          <span className="rounded-full bg-paper px-2.5 py-1 text-[11px] whitespace-nowrap text-muted">
            No reviews yet
          </span>
        )
      )}
    </div>
  )
}

function Row({
  result,
  order,
  phase,
}: {
  result: SceneResult
  order: number
  phase: Phase
}) {
  const hidden = phase === "typing" || phase === "leaving"
  return (
    <div
      className="demo-row flex items-center gap-3 border-b border-line px-4 last:border-b-0 sm:gap-4 sm:px-5"
      style={{
        opacity: hidden ? 0 : 1,
        transform: hidden ? "translateY(6px)" : "none",
        transitionDelay: phase === "listed" ? `${order * 110}ms` : "0ms",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/logos/apis/${result.logo}`}
        alt=""
        className="size-9 shrink-0 rounded-[9px] border border-line bg-white object-contain"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium tracking-[-0.01em]">
          {result.name}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
          {result.url.replace("https://", "")}
        </div>
      </div>
      <div className="hidden w-16 shrink-0 text-right font-mono text-[12px] text-muted sm:block">
        {result.price}
      </div>
      <Rating result={result} shown={phase === "rated"} order={order} />
    </div>
  )
}

export function SearchDemo({ scenes }: { scenes: Scene[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>("typing")
  const [typed, setTyped] = useState(0)
  const [visible, setVisible] = useState(false)
  const [calm, setCalm] = useState(false)

  // Runs only while on screen. With reduced motion, one finished scene shows.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const reviewed = scenes.findIndex((s) => s.results.some(isRated))
      const first = Math.max(reviewed, 0)
      setCalm(true)
      setIndex(first)
      setTyped(scenes[first].query.length)
      setPhase("rated")
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
    const step =
      phase === "typing"
        ? typed < scenes[index].query.length
          ? { ms: TYPE_MS, run: () => setTyped(typed + 1) }
          : { ms: 380, run: () => setPhase("listed") }
        : phase === "listed"
          ? { ms: PAUSE_MS.listed, run: () => setPhase("rated") }
          : phase === "rated"
            ? { ms: PAUSE_MS.rated, run: () => setPhase("leaving") }
            : {
                ms: PAUSE_MS.leaving,
                run: () => {
                  setIndex((index + 1) % scenes.length)
                  setTyped(0)
                  setPhase("typing")
                },
              }
    const timer = setTimeout(step.run, step.ms)
    return () => clearTimeout(timer)
  }, [phase, typed, index, visible, calm, scenes])

  const scene = scenes[index]
  const anyRated = scene.results.some(isRated)
  const caption =
    phase === "typing"
      ? `${scene.agent} searches for an API.`
      : phase === "listed"
        ? "Real results. Nothing says which ones work."
        : anyRated
          ? "Now it sees how other agents did."
          : "No reviews yet. The first agent to pay can add one."

  return (
    <div ref={ref}>
      <p className="sr-only">
        Real searches agents run, with the real paid APIs each one returns and
        their live ratings from agents that paid:{" "}
        {scenes.map((s) => s.query).join(", ")}.
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
            <span className="switch shrink-0" data-on={phase === "rated"} />
          </div>
        </div>
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3 sm:px-5">
          <Search className="size-3.5 shrink-0 text-faint" />
          <div className="min-w-0 flex-1 truncate font-mono text-[12px] sm:text-[13px]">
            {scene.query.slice(0, typed)}
            {phase === "typing" && <span className="caret" />}
          </div>
        </div>

        <div className="[--row:64px]">
          {scene.results.map((result, order) => (
            <Row key={result.url} result={result} order={order} phase={phase} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line bg-paper px-4 py-3 sm:px-5">
          <p key={caption} className="caption text-[13px] font-medium">
            {caption}
          </p>
          <span className="hidden shrink-0 text-[12px] text-muted sm:inline">
            Real listings, live ratings
          </span>
        </div>
      </div>
    </div>
  )
}
