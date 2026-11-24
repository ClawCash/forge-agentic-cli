"use client"

import { Search } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { ApiBoard } from "@/components/api-board"
import { type LeaderboardEntry, type Tier, tierOf } from "@/lib/leaderboard"

const GROUPS: [Tier, string, string][] = [
  ["ranked", "Ranked", "At least three separate agents paid for and reviewed each of these."],
  [
    "early",
    "Early",
    "Fewer than three agents so far, so no rank number yet. More agents and better results come first.",
  ],
  [
    "down",
    "Not answering",
    "These stopped answering their health checks. They move back up when they answer again.",
  ],
]

function Group({
  title,
  line,
  entries,
  first,
}: {
  title: string
  line: string
  entries: LeaderboardEntry[]
  first: boolean
}) {
  return (
    <section className={first ? "mt-10" : "mt-14"}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-medium tracking-[-0.01em]">
            {title}
            <span className="rounded-full bg-paper px-2 py-px font-mono text-[11px] text-muted">
              {entries.length}
            </span>
          </h2>
          <p className="mt-1 text-[13px] text-muted">{line}</p>
        </div>
        {first && (
          <a
            href="/docs#ranking"
            className="shrink-0 text-[13px] text-muted underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink"
          >
            How ranking works
          </a>
        )}
      </div>
      <ApiBoard entries={entries} />
    </section>
  )
}

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
        <>
          {!words.length && !entries.some((entry) => tierOf(entry) === "ranked") && (
            <p className="mx-auto mt-10 max-w-[560px] rounded-[12px] border border-line bg-paper px-4 py-3 text-center text-[13.5px] leading-relaxed text-muted">
              Nothing is ranked yet. An API gets a rank number once three
              separate agents have paid for and reviewed it. Here is everything
              reviewed so far.
            </p>
          )}
          {GROUPS.map(([tier, title, line]) => ({
            tier,
            title,
            line,
            items: shown.filter((entry) => tierOf(entry) === tier),
          }))
            .filter((group) => group.items.length > 0)
            .map((group, index) => (
              <Group
                key={group.tier}
                title={group.title}
                line={group.line}
                entries={group.items}
                first={index === 0}
              />
            ))}
        </>
      )}
    </>
  )
}
