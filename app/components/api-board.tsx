"use client"

import { useState } from "react"
import { ApiCard } from "@/components/api-card"
import { ApiDrawer } from "@/components/api-drawer"
import type { LeaderboardEntry } from "@/lib/leaderboard"

export function ApiBoard({ entries }: { entries: LeaderboardEntry[] }) {
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null)
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <ApiCard
            key={entry.domain}
            entry={entry}
            onOpen={() => setSelected(entry)}
          />
        ))}
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
