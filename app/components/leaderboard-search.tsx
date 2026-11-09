"use client"

import { Search } from "lucide-react"
import { type ReactNode, useState } from "react"
import { ApiCard } from "@/components/api-card"
import type { LeaderboardEntry } from "@/lib/leaderboard"

function matches(entry: LeaderboardEntry, words: string[]) {
  const text = [entry.name, entry.domain, entry.description, ...entry.notes]
    .join(" ")
    .toLowerCase()
  return words.every((word) => text.includes(word))
}

export function LeaderboardSearch({
  entries,
  filters,
  empty,
}: {
  entries: LeaderboardEntry[]
  filters: ReactNode
  empty: ReactNode
}) {
  const [query, setQuery] = useState("")
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = entries.filter((entry) => matches(entry, words))

  return (
    <>
      <label className="relative mx-auto mt-8 block max-w-[520px]">
        <span className="sr-only">Search APIs</span>
        <Search
          aria-hidden="true"
          className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, domain or what it does"
          className="h-11 w-full rounded-[10px] border border-line bg-white pr-3 pl-10 text-[14px] transition-colors duration-150 outline-none placeholder:text-faint hover:border-faint focus:border-ink"
        />
      </label>
      {filters}
      {entries.length === 0 ? (
        empty
      ) : shown.length === 0 ? (
        <p className="mt-14 text-center text-[15px] text-muted">
          No APIs match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <div className="mx-auto mt-12 max-w-[780px] space-y-3">
          {shown.map((entry) => (
            <ApiCard key={entry.domain} entry={entry} />
          ))}
        </div>
      )}
    </>
  )
}
