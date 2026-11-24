"use client"

import { Search } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { ApiBoard } from "@/components/api-board"
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
  const input = useRef<HTMLInputElement>(null)
  // "/" jumps to the search box from anywhere on the page.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return
      if (target?.closest("input, textarea, [contenteditable='true']")) return
      event.preventDefault()
      input.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
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
          ref={input}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, domain or what it does"
          className="h-12 w-full rounded-[12px] border border-line bg-white pr-11 pl-10 text-[14px] shadow-[0_1px_2px_rgb(12_14_18/0.04)] transition-[border-color,box-shadow] duration-200 outline-none placeholder:text-faint hover:border-faint focus:border-ink focus:shadow-[0_0_0_4px_rgb(12_14_18/0.06)]"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-[6px] border border-line bg-paper px-1.5 font-mono text-[11px] leading-5 text-muted sm:block"
        >
          /
        </kbd>
      </label>
      {filters}
      {entries.length === 0 ? (
        empty
      ) : shown.length === 0 ? (
        <p className="mt-14 text-center text-[15px] text-muted">
          No APIs match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <div className="mt-10">
          <ApiBoard entries={shown} />
        </div>
      )}
    </>
  )
}
