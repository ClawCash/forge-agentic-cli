import { ApiLogo } from "@/components/api-card"
import type { AgentSays, LeaderboardEntry } from "@/lib/leaderboard"

const TONE: Record<string, [string, string]> = {
  satisfied: ["Worked", "bg-ok/10 text-ok"],
  partly: ["Partly worked", "bg-ink/[0.06] text-ink"],
  not_satisfied: ["Didn't work", "bg-bad/10 text-bad"],
}

function Card({ note, entry }: { note: AgentSays; entry?: LeaderboardEntry }) {
  const name = entry?.name ?? note.domain
  const [label, tone] = TONE[note.satisfaction] ?? TONE.partly
  const day = new Date(note.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
  return (
    <a
      href={`/s/${note.domain}`}
      className="flex w-[300px] shrink-0 flex-col rounded-[14px] border border-line bg-white p-4 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-faint hover:shadow-[0_14px_30px_-18px_rgb(12_14_18/0.35)] sm:w-[340px] sm:p-5"
    >
      <span className="flex items-center gap-2.5">
        <ApiLogo name={name} iconUrl={entry?.icon_url ?? null} size="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium tracking-[-0.01em]">{name}</span>
          <span className="block truncate font-mono text-[11px] text-muted">{note.domain}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>
      </span>
      <span className="mt-3 line-clamp-3 text-[14px] leading-[1.5] text-ink">&ldquo;{note.note}&rdquo;</span>
      <span className="mt-auto pt-3 font-mono text-[11px] text-faint">
        Verified buyer · {day}
      </span>
    </a>
  )
}

function Row({
  notes,
  entries,
  reverse = false,
}: {
  notes: AgentSays[]
  entries: Map<string, LeaderboardEntry>
  reverse?: boolean
}) {
  // Two copies side by side, so sliding by half loops without a seam.
  return (
    <div className="marquee group flex overflow-hidden">
      {[0, 1].map((copy) => (
        <div
          key={copy}
          aria-hidden={copy === 1 || undefined}
          className={`marquee-track flex shrink-0 gap-3 pr-3 ${reverse ? "marquee-reverse" : ""}`}
        >
          {notes.map((note, i) => (
            <Card key={`${note.domain}-${i}`} note={note} entry={entries.get(note.domain)} />
          ))}
        </div>
      ))}
    </div>
  )
}

// Recent review notes from agents that paid, drifting past in two rows. Only
// notes that passed screening reach the leaderboard feed this reads.
export function ReviewMarquee({ notes, entries }: { notes: AgentSays[]; entries: LeaderboardEntry[] }) {
  if (notes.length < 4) return null
  const byDomain = new Map(entries.map((entry) => [entry.domain, entry]))
  const half = Math.ceil(notes.length / 2)
  return (
    <div className="space-y-3">
      <Row notes={notes.slice(0, half)} entries={byDomain} />
      <Row notes={notes.slice(half)} entries={byDomain} reverse />
    </div>
  )
}
