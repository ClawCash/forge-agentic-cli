import { BadgeCheck } from "lucide-react"
import { Stars } from "@/components/ui"
import type { ApiSummary, LeaderboardEntry } from "@/lib/leaderboard"

const VERDICTS: Record<string, [string, string]> = {
  use: ["Use", "bg-ok/10 text-ok"],
  caution: ["Caution", "bg-ink/[0.07] text-ink"],
  avoid: ["Avoid", "bg-bad/10 text-bad"],
  unknown: ["New", "bg-paper text-muted"],
}

export function verdictOf(entry: Pick<ApiSummary, "verdict">) {
  return VERDICTS[entry.verdict] ?? VERDICTS.unknown
}

// Marked as an estimate until enough different agents have reported.
// Needs three agents: from one review it would read like a measured rate.
export function likelyToWork(
  entry: Pick<ApiSummary, "buyers" | "works_for_task">
) {
  if (entry.works_for_task === null || entry.buyers < 3) return null
  return `${Math.round(entry.works_for_task * 100)}%`
}

// Shown next to an API's name once its owner has claimed and verified it.
export function VerifiedBadge({ className = "size-4" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Verified owner"
      title="Verified owner: claimed and verified by DNS"
      className="inline-flex shrink-0"
    >
      <BadgeCheck className={`${className} fill-ok text-white`} />
    </span>
  )
}

export function ApiLogo({
  name,
  iconUrl,
  size = "size-11",
}: {
  name: string
  iconUrl: string | null
  size?: string
}) {
  return iconUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl}
      alt=""
      loading="lazy"
      className={`${size} shrink-0 rounded-[10px] border border-line object-contain`}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`${size} grid shrink-0 place-items-center rounded-[10px] bg-paper font-display text-[15px] font-medium text-muted`}
    >
      {name[0].toUpperCase()}
    </span>
  )
}

export function ApiCard({
  entry,
  onOpen,
  starsShown = true,
}: {
  entry: LeaderboardEntry
  onOpen: () => void
  starsShown?: boolean
}) {
  const name = entry.name ?? entry.domain
  const [verdict, tone] = verdictOf(entry)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="lift flex h-full w-full flex-col rounded-[14px] border border-line bg-white p-4 text-left focus-visible:border-ink focus-visible:outline-none active:scale-[0.99]"
    >
      <span className="flex w-full items-start gap-3">
        <ApiLogo name={name} iconUrl={entry.icon_url} size="size-9" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="truncate text-[14px] leading-[18px] font-medium tracking-[-0.01em]">
              {name}
            </span>
            {entry.verified && <VerifiedBadge className="size-[15px]" />}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] leading-4 text-muted">
            <span className="truncate">{entry.domain}</span>
            {entry.health?.status === "down" && (
              <span className="shrink-0 font-sans text-bad">
                Not responding
              </span>
            )}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
        >
          {verdict}
        </span>
      </span>
      <span className="mt-2.5 line-clamp-2 min-h-9 text-[13px] leading-[18px] text-muted">
        {entry.description}
      </span>
      <span className="mt-3 flex w-full items-center gap-1.5 text-[12px] text-muted">
        <Stars value={entry.stars} size="size-3" shown={starsShown} />
        <span className="font-mono font-medium text-ink">
          {entry.stars.toFixed(1)}
        </span>
        <span className="ml-0.5">
          · {entry.buyers} {entry.buyers === 1 ? "agent" : "agents"} ·{" "}
          {likelyToWork(entry)
            ? `${likelyToWork(entry)} likely to work`
            : "too early to tell"}
        </span>
        <span
          className={`ml-auto font-mono ${
            entry.rank <= 3
              ? "rounded-full bg-ink px-1.5 py-px text-[10.5px] font-medium text-white"
              : "text-faint"
          }`}
        >
          #{entry.rank}
        </span>
      </span>
    </button>
  )
}
