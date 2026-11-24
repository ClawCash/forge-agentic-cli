import { ApiLogo, likelyToWork, VerifiedBadge } from "@/components/api-card"
import { Stars } from "@/components/ui"
import { nameOf } from "@/lib/categories"
import { type LeaderboardEntry, tierOf } from "@/lib/leaderboard"

const money = (usd: number) =>
  usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${Number(usd.toPrecision(2))}`

// One API as a row that links to its page: the crawlable version of a
// leaderboard card, for the category pages.
function Row({ entry }: { entry: LeaderboardEntry }) {
  const name = nameOf(entry)
  const likely = likelyToWork(entry)
  const tier = tierOf(entry)
  return (
    <li>
      <a
        href={`/s/${entry.domain}`}
        className="lift grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-[14px] border border-line bg-white p-4 sm:grid-cols-[32px_minmax(0,1fr)_auto] sm:gap-x-4"
      >
        <span
          className={`grid size-7 place-items-center rounded-full font-mono text-[11px] font-medium sm:size-8 ${
            entry.rank !== null && entry.rank <= 3
              ? "bg-ink text-white"
              : entry.rank !== null
                ? "bg-paper text-ink"
                : "text-faint"
          }`}
          aria-label={
            entry.rank !== null
              ? `Rank ${entry.rank}`
              : tier === "down"
                ? "Not answering"
                : "Early, not ranked yet"
          }
        >
          {entry.rank ?? "–"}
        </span>
        <span className="flex min-w-0 items-center gap-3">
          <ApiLogo name={name} iconUrl={entry.icon_url} size="size-10" />
          <span className="min-w-0">
            <span className="flex items-center gap-1">
              <span className="truncate text-[15px] font-medium tracking-[-0.01em]">
                {name}
              </span>
              {entry.verified && <VerifiedBadge className="size-[15px]" />}
            </span>
            <span className="block truncate font-mono text-[11.5px] text-muted">
              {entry.domain}
              {tier === "down" && (
                <span className="ml-2 font-sans text-bad">Not responding</span>
              )}
            </span>
            {entry.description && (
              <span className="mt-0.5 line-clamp-1 text-[13px] text-muted">
                {entry.description}
              </span>
            )}
          </span>
        </span>
        <span className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted sm:col-start-3 sm:justify-end sm:text-right">
          <span className="flex items-center gap-1.5">
            <Stars value={entry.stars} size="size-3" />
            <span className="font-mono font-medium text-ink">
              {entry.stars.toFixed(1)}
            </span>
          </span>
          <span>
            {entry.buyers} {entry.buyers === 1 ? "agent" : "agents"}
          </span>
          <span>{likely ? `${likely} likely to work` : "Too early to tell"}</span>
          {typeof entry.price_usd === "number" && entry.price_usd > 0 && (
            <span className="font-mono">{money(entry.price_usd)}/call</span>
          )}
        </span>
      </a>
    </li>
  )
}

const GROUPS = [
  ["ranked", "Ranked", "Three or more separate agents paid for and reviewed each of these."],
  ["early", "Early", "Fewer than three agents so far, so no rank number yet."],
  ["down", "Not answering", "These stopped answering their health checks."],
] as const

export function RankedList({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="space-y-10">
      {GROUPS.map(([tier, title, line]) => {
        const items = entries.filter((entry) => tierOf(entry) === tier)
        if (items.length === 0) return null
        return (
          <section key={tier}>
            <h2 className="flex items-center gap-2 text-[15px] font-medium tracking-[-0.01em]">
              {title}
              <span className="rounded-full bg-paper px-2 py-px font-mono text-[11px] text-muted">
                {items.length}
              </span>
            </h2>
            <p className="mt-1 text-[13px] text-muted">{line}</p>
            <ol className="mt-4 space-y-2.5">
              {items.map((entry) => (
                <Row key={entry.domain} entry={entry} />
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
