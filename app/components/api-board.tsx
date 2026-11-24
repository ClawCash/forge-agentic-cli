"use client"

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react"
import { useRef, useState } from "react"
import { ApiCard } from "@/components/api-card"
import { ApiDrawer } from "@/components/api-drawer"
import type { LeaderboardEntry } from "@/lib/leaderboard"

const EASE = [0.16, 1, 0.3, 1] as const

// One card: rises in when it scrolls into view, fills its stars as it lands,
// and glides to its new spot when a search reflows the grid.
function BoardItem({
  entry,
  index,
  onOpen,
}: {
  entry: LeaderboardEntry
  index: number
  onOpen: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const reduce = !!useReducedMotion()
  return (
    <motion.div
      ref={ref}
      layout={reduce ? false : "position"}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, filter: "blur(6px)" }}
      animate={inView ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ duration: reduce ? 0.2 : 0.6, ease: EASE, delay: reduce ? 0 : (index % 3) * 0.06 }}
    >
      <ApiCard entry={entry} onOpen={onOpen} starsShown={inView} />
    </motion.div>
  )
}

export function ApiBoard({ entries }: { entries: LeaderboardEntry[] }) {
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null)
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence>
          {entries.map((entry, index) => (
            <BoardItem
              key={entry.domain}
              entry={entry}
              index={index}
              onOpen={() => setSelected(entry)}
            />
          ))}
        </AnimatePresence>
      </div>
      {selected && (
        <ApiDrawer
          key={selected.domain}
          entry={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
