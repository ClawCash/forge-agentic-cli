"use client"

import { motion, useInView, useReducedMotion } from "motion/react"
import { type ReactNode, useEffect, useRef, useState } from "react"

const EASE = [0.16, 1, 0.3, 1] as const

export interface Tile {
  key: string
  href: string
  label: ReactNode
}

// The agents and wallets 402reviews works with. Tiles rise in one after
// another, then a highlight steps through each group, one tile at a time, as
// if a check were passing through it.
function Group({
  label,
  tiles,
  inView,
  offset,
}: {
  label: string
  tiles: Tile[]
  inView: boolean
  offset: number
}) {
  const reduce = !!useReducedMotion()
  const [lit, setLit] = useState(-1)

  useEffect(() => {
    if (reduce || !inView) return
    const start = setTimeout(() => setLit(0), 900 + offset)
    return () => clearTimeout(start)
  }, [reduce, inView, offset])

  useEffect(() => {
    if (reduce || !inView || lit < 0) return
    const timer = setTimeout(() => setLit((lit + 1) % tiles.length), 1100)
    return () => clearTimeout(timer)
  }, [lit, reduce, inView, tiles.length])

  return (
    <div>
      <h3 className="label">{label}</h3>
      <ul className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        {tiles.map((tile, i) => (
          <motion.li
            key={tile.key}
            initial={reduce ? false : { opacity: 0, y: 14, scale: 0.96, filter: "blur(4px)" }}
            animate={inView ? { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } : undefined}
            transition={{ duration: 0.55, ease: EASE, delay: (offset / 1000) + i * 0.05 }}
          >
            <a
              href={tile.href}
              target="_blank"
              rel="noreferrer"
              data-lit={i === lit || undefined}
              className="works-tile lift relative flex h-[84px] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[12px] border border-line bg-white px-2 text-center text-[12px] leading-tight font-medium tracking-[-0.01em] sm:h-[72px] sm:flex-row sm:gap-2.5 sm:px-3 sm:text-[14px]"
            >
              {tile.label}
            </a>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

// The command types itself out the first time it scrolls into view.
export function TypedCommand({ text }: { text: string }) {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.8 })
  const reduce = !!useReducedMotion()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!inView || reduce || count >= text.length) return
    const timer = setTimeout(() => setCount(count + 1), 22)
    return () => clearTimeout(timer)
  }, [inView, reduce, count, text.length])
  const shown = reduce ? text : text.slice(0, count)
  return (
    <code
      ref={ref}
      className="mt-1.5 block overflow-x-auto font-mono text-[12.5px] whitespace-nowrap text-muted"
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {shown}
        {!reduce && count < text.length && <span className="caret !h-3 !w-1.5" />}
      </span>
    </code>
  )
}

export function WorksWithGrid({ agents, clients }: { agents: Tile[]; clients: Tile[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.25 })
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (inView) setSeen(true)
  }, [inView])
  return (
    <div ref={ref} className="mt-14 grid gap-10 lg:grid-cols-2 lg:gap-8">
      <Group label="AI agents" tiles={agents} inView={seen && inView} offset={0} />
      <Group label="Wallets and CLIs" tiles={clients} inView={seen && inView} offset={550} />
    </div>
  )
}
