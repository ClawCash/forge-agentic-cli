import { Stars } from "@/components/ui"
import type { LeaderboardEntry } from "@/lib/leaderboard"

const VERDICTS: Record<string, [string, string]> = {
  use: ["Use", "bg-ok/10 text-ok"],
  caution: ["Caution", "bg-ink/[0.07] text-ink"],
  avoid: ["Avoid", "bg-bad/10 text-bad"],
  unknown: ["New", "bg-paper text-muted"],
}

export function verdictOf(entry: LeaderboardEntry) {
  return VERDICTS[entry.verdict] ?? VERDICTS.unknown
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
}: {
  entry: LeaderboardEntry
  onOpen: () => void
}) {
  const name = entry.name ?? entry.domain
  const [verdict, tone] = verdictOf(entry)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex h-full w-full flex-col rounded-[12px] border border-line bg-white p-4 text-left transition-colors duration-150 hover:border-faint focus-visible:border-ink focus-visible:outline-none"
    >
      <span className="flex w-full items-start gap-3">
        <ApiLogo name={name} iconUrl={entry.icon_url} size="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] leading-[18px] font-medium tracking-[-0.01em]">
            {name}
          </span>
          <span className="block truncate font-mono text-[11px] leading-4 text-muted">
            {entry.domain}
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
        <Stars value={entry.stars} size="size-3" />
        <span className="font-mono font-medium text-ink">
          {entry.stars.toFixed(1)}
        </span>
        <span className="ml-1.5">
          {Math.round(entry.works_for_task * 100)}% worked
        </span>
        <span className="ml-auto font-mono text-faint">#{entry.rank}</span>
      </span>
    </button>
  )
}
