import {
  LogOut,
  MessageSquareText,
  TriangleAlert,
  UserPlus,
} from "lucide-react"
import type { ReactNode } from "react"
import { Mark } from "@/components/ui"
import type { AdminStats } from "@/lib/admin"

const number = (value: number) => value.toLocaleString("en-US")

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

function ago(iso: string, now: number) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 30 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`
  return shortDate(iso)
}

const KIND_NAMES: Record<string, string> = {
  check: "Checks",
  brief: "Search ratings",
  service: "Ratings and profiles",
  search: "Searches",
  probe: "Probes",
  review: "Reviews and reports",
  leaderboard: "Leaderboard",
  account: "Account",
}

function Card({
  title,
  note,
  children,
  className = "",
}: {
  title: string
  note?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-[14px] border border-line bg-white p-5 sm:p-6 ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {note && <span className="text-[12px] text-muted">{note}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Tile({
  label,
  value,
  note,
  big = false,
}: {
  label: string
  value: number
  note: string
  big?: boolean
}) {
  return (
    <div className="rounded-[14px] border border-line bg-white p-4 sm:p-5">
      <div className="label">{label}</div>
      <div
        className={`mt-2 font-display font-medium tracking-[-0.02em] tabular-nums ${
          big ? "text-[34px] leading-none" : "text-[24px] leading-none"
        }`}
      >
        {number(value)}
      </div>
      <div className="mt-2 text-[13px] text-muted">{note}</div>
    </div>
  )
}

function DailyChart({ daily }: { daily: AdminStats["daily"] }) {
  const max = Math.max(1, ...daily.map((day) => day.active))
  const ticks = [max, Math.round(max / 2), 0].filter(
    (tick, i, all) => all.indexOf(tick) === i
  )
  return (
    <figure>
      <div className="relative h-[168px] pl-7">
        {ticks.map((tick) => (
          <div
            key={tick}
            className="absolute right-0 left-7 border-t border-line"
            style={{ bottom: `${(tick / max) * 100}%` }}
          >
            <span className="absolute -top-2 -left-7 w-5 text-right font-mono text-[10px] text-faint tabular-nums">
              {tick}
            </span>
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-7 flex items-end gap-[2px]">
          {daily.map((day, i) => {
            const align =
              i < 5
                ? "left-0"
                : i > daily.length - 6
                  ? "right-0"
                  : "left-1/2 -translate-x-1/2"
            return (
              <div
                key={day.day}
                tabIndex={0}
                aria-label={`${shortDate(day.day)}: ${day.active} active`}
                className="group relative flex h-full flex-1 items-end justify-center outline-none"
              >
                <div
                  className={`w-full max-w-[18px] rounded-t-[4px] transition-opacity group-hover:opacity-75 group-focus-visible:opacity-75 ${
                    day.active ? "bg-ink" : "h-[2px] bg-line"
                  }`}
                  style={
                    day.active
                      ? { height: `${(day.active / max) * 100}%` }
                      : undefined
                  }
                />
                <div
                  role="tooltip"
                  className={`pointer-events-none absolute bottom-full z-10 mb-2 hidden w-max rounded-[10px] border border-line bg-white px-3 py-2 text-[12px] shadow-[0_8px_24px_-8px_rgb(12_14_18/0.2)] group-hover:block group-focus-visible:block ${align}`}
                >
                  <div className="font-medium">{shortDate(day.day)}</div>
                  <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 text-muted tabular-nums">
                    <span>Active</span>
                    <span className="text-right text-ink">{day.active}</span>
                    <span>Sign-ups</span>
                    <span className="text-right text-ink">{day.signups}</span>
                    <span>Reviews</span>
                    <span className="text-right text-ink">{day.reviews}</span>
                    <span>Requests</span>
                    <span className="text-right text-ink">
                      {number(day.requests)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between pl-7 font-mono text-[10px] text-faint">
        <span>{shortDate(daily[0].day)}</span>
        <span>{shortDate(daily[Math.floor(daily.length / 2)].day)}</span>
        <span>Today</span>
      </div>
      <details className="mt-4 text-[13px]">
        <summary className="cursor-pointer text-muted hover:text-ink">
          Show as a table
        </summary>
        <div className="mt-3 max-h-[280px] overflow-auto">
          <table className="w-full tabular-nums">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1.5 font-normal">Day</th>
                <th className="py-1.5 text-right font-normal">Active</th>
                <th className="py-1.5 text-right font-normal">Sign-ups</th>
                <th className="py-1.5 text-right font-normal">Reviews</th>
                <th className="py-1.5 text-right font-normal">Requests</th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((day) => (
                <tr key={day.day} className="border-t border-line">
                  <td className="py-1.5">{shortDate(day.day)}</td>
                  <td className="py-1.5 text-right">{day.active}</td>
                  <td className="py-1.5 text-right">{day.signups}</td>
                  <td className="py-1.5 text-right">{day.reviews}</td>
                  <td className="py-1.5 text-right">{number(day.requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

function People({
  people,
  now,
}: {
  people: AdminStats["people"]
  now: number
}) {
  if (people.length === 0) {
    return <p className="text-[14px] text-muted">No sign-ups yet.</p>
  }
  const head = "py-2 pr-4 font-normal whitespace-nowrap"
  const cell = "py-2.5 pr-4 whitespace-nowrap"
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
      <table className="w-full text-[13px] tabular-nums">
        <thead className="text-left text-muted">
          <tr>
            <th className={head}>Email</th>
            <th className={head}>Signed up</th>
            <th className={head}>Last active</th>
            <th className={`${head} text-right`}>Reviews</th>
            <th className={`${head} text-right`}>Failure reports</th>
            <th className={`${head} text-right`}>Requests</th>
            <th className={`${head} pr-0`}>Auto-review</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.email} className="border-t border-line">
              <td className={cell}>
                <span className="font-medium">{person.email}</span>
                {person.seeded_reviews > 0 && (
                  <span className="ml-2 rounded-[5px] bg-paper px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-line ring-inset">
                    seed
                  </span>
                )}
              </td>
              <td className={cell} title={person.signed_up_at}>
                {shortDate(person.signed_up_at)}
              </td>
              <td className={cell} title={person.last_active_at}>
                {ago(person.last_active_at, now)}
              </td>
              <td className={`${cell} text-right`}>{number(person.reviews)}</td>
              <td className={`${cell} text-right`}>
                {number(person.failure_reports)}
              </td>
              <td className={`${cell} text-right`}>
                {number(person.requests)}
              </td>
              <td className={`${cell} pr-0`}>
                {person.auto_review ? "On" : "Off"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const EVENT_STYLE = {
  signup: { icon: UserPlus, label: "Sign-up" },
  review: { icon: MessageSquareText, label: "Review" },
  failure_report: { icon: TriangleAlert, label: "Failure report" },
}

function Activity({
  activity,
  now,
}: {
  activity: AdminStats["activity"]
  now: number
}) {
  if (activity.length === 0) {
    return <p className="text-[14px] text-muted">Nothing yet.</p>
  }
  return (
    <ol className="divide-y divide-line">
      {activity.map((event, i) => {
        const { icon: Icon, label } = EVENT_STYLE[event.type]
        return (
          <li key={`${event.at}-${i}`} className="flex gap-3 py-3 first:pt-0">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-paper ring-1 ring-line ring-inset">
              <Icon className="size-3.5 text-muted" aria-label={label} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={`truncate text-[13px] ${
                    event.type === "signup" ? "font-medium" : "font-mono"
                  }`}
                >
                  {event.type === "signup" ? event.who : event.title}
                </span>
                <span
                  className="shrink-0 text-[12px] text-faint"
                  title={event.at}
                >
                  {ago(event.at, now)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[12px] text-muted">
                {event.type === "signup"
                  ? "Signed up"
                  : [event.detail, event.seeded ? "402reviews seed" : event.who]
                      .filter(Boolean)
                      .join(" · ")}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Requests({ stats }: { stats: AdminStats }) {
  return (
    <div className="space-y-6">
      {stats.requests_by_kind.length === 0 ? (
        <p className="text-[14px] text-muted">No API requests yet.</p>
      ) : (
        <table className="w-full text-[13px] tabular-nums">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1.5 font-normal">Kind</th>
              <th className="py-1.5 text-right font-normal">Signed in</th>
              <th className="py-1.5 text-right font-normal">Anonymous</th>
            </tr>
          </thead>
          <tbody>
            {stats.requests_by_kind.map((row) => (
              <tr key={row.kind} className="border-t border-line">
                <td className="py-2">{KIND_NAMES[row.kind] ?? row.kind}</td>
                <td className="py-2 text-right">{number(row.signed_in)}</td>
                <td className="py-2 text-right">{number(row.anonymous)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {stats.clients.length > 0 && (
        <div>
          <h3 className="label">Top clients, last 7 days</h3>
          <ul className="mt-2 divide-y divide-line text-[13px]">
            {stats.clients.map((row) => (
              <li
                key={row.client}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <span
                  className="truncate font-mono text-[12px]"
                  title={row.client}
                >
                  {row.client}
                </span>
                <span className="shrink-0 tabular-nums">
                  {number(row.requests)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function Dashboard({ stats }: { stats: AdminStats }) {
  const now = Date.parse(stats.generated_at)
  const { active, totals } = stats
  const updated = new Date(stats.generated_at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  })
  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-[1160px] items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-2">
            <Mark className="size-[24px]" />
            <span className="font-display text-[16px] font-medium tracking-[-0.02em]">
              402reviews
            </span>
            <span className="rounded-[6px] bg-paper px-2 py-0.5 text-[12px] text-muted ring-1 ring-line ring-inset">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-[12px] text-muted sm:inline">
              Updated {updated} UTC
            </span>
            <form action="/admin/logout" method="post">
              <button
                type="submit"
                className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
              >
                <LogOut className="size-3.5" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1160px] space-y-4 px-4 py-6 sm:px-8 sm:py-8">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile big label="DAU" value={active.dau} note="Active today" />
          <Tile big label="WAU" value={active.wau} note="Last 7 days" />
          <Tile big label="MAU" value={active.mau} note="Last 30 days" />
          <Tile big label="TAU" value={active.tau} note="All time" />
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile
            label="Sign-ups"
            value={totals.users}
            note={`+${number(totals.users_last_7_days)} this week`}
          />
          <Tile
            label="Reviews"
            value={totals.reviews}
            note={`${number(totals.reviews_seeded)} seeded, +${number(totals.reviews_last_7_days)} this week`}
          />
          <Tile
            label="Auto-review on"
            value={totals.auto_review_on}
            note={`of ${number(totals.users)} accounts`}
          />
          <Tile
            label="Failure reports"
            value={totals.failure_reports}
            note="Payments that failed uncharged"
          />
          <Tile
            label="API requests"
            value={totals.requests_last_30_days}
            note={`Last 30 days, ${number(totals.anonymous_requests_last_30_days)} anonymous`}
          />
        </div>

        <Card title="Daily active users" note="Last 30 days, UTC">
          <DailyChart daily={stats.daily} />
        </Card>

        <Card
          title="People"
          note={`${number(stats.people.length)} accounts, most recently active first`}
        >
          <People people={stats.people} now={now} />
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card
            title="Recent activity"
            note="Sign-ups, reviews and failure reports"
          >
            <Activity activity={stats.activity} now={now} />
          </Card>
          <Card title="API requests" note="Last 30 days">
            <Requests stats={stats} />
          </Card>
        </div>

        <p className="px-1 text-[12px] leading-relaxed text-muted">
          Someone is active on a day when they sign up, make a signed-in API
          request, post a review or report a failed payment. Ratings shown in
          wallet searches come from a cached file, so they aren&apos;t counted.
        </p>
      </main>
    </div>
  )
}
