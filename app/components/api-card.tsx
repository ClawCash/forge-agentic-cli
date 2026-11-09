import { Stars } from "@/components/ui"
import type { LeaderboardEntry } from "@/lib/leaderboard"

const VERDICTS: Record<string, [string, string]> = {
  use: ["Use", "bg-ok/10 text-ok"],
  caution: ["Caution", "bg-star/15 text-warn"],
  avoid: ["Avoid", "bg-bad/10 text-bad"],
  unknown: ["New", "bg-paper text-muted"],
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
      className={`${size} grid shrink-0 place-items-center rounded-[10px] bg-paper font-display text-[17px] font-medium text-muted`}
    >
      {name[0].toUpperCase()}
    </span>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[13px] font-medium">{value}</span>
      <span className="text-[12px] text-muted">{label}</span>
    </div>
  )
}

export function ApiCard({
  entry,
  showQuote = true,
}: {
  entry: LeaderboardEntry
  showQuote?: boolean
}) {
  const name = entry.name ?? entry.domain
  const [verdict, tone] = VERDICTS[entry.verdict] ?? VERDICTS.unknown
  const quote = showQuote ? entry.notes[0] : undefined
  return (
    <article className="flex gap-3 rounded-[14px] border border-line bg-white p-5 transition-colors duration-150 hover:border-faint sm:gap-4 sm:p-6">
      <span className="w-4 shrink-0 pt-3 text-center font-mono text-[13px] text-faint">
        {entry.rank}
      </span>
      <ApiLogo name={name} iconUrl={entry.icon_url} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[16px] leading-[22px] font-medium tracking-[-0.01em]">
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer nofollow"
                className="underline-offset-4 hover:underline"
              >
                {name}
              </a>
            </h3>
            <div className="truncate font-mono text-[12px] leading-5 text-muted">
              {entry.domain}
            </div>
          </div>
          <span
            title={
              entry.verdict === "unknown" ? "Fewer than 3 buyers so far" : ""
            }
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${tone}`}
          >
            {verdict}
          </span>
        </div>
        {entry.description && (
          <p className="mt-3 line-clamp-2 text-[14px] leading-[1.55] text-muted">
            {entry.description}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <Stars value={entry.stars} size="size-3.5" />
            <span className="font-mono text-[13px] font-medium">
              {entry.stars.toFixed(1)}
            </span>
          </div>
          <Stat
            value={`${Math.round(entry.works_for_task * 100)}%`}
            label="worked"
          />
          {entry.satisfied !== null && (
            <Stat
              value={`${Math.round(entry.satisfied * 100)}%`}
              label="satisfied"
            />
          )}
          <Stat
            value={String(entry.buyers)}
            label={entry.buyers === 1 ? "buyer" : "buyers"}
          />
        </div>
        {quote && (
          <blockquote className="mt-4 border-t border-line pt-4 text-[14px] leading-[1.55]">
            &ldquo;{quote}&rdquo;
          </blockquote>
        )}
      </div>
    </article>
  )
}
