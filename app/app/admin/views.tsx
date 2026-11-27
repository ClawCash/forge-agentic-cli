"use client"

import {
  BadgeCheck,
  FileText,
  Globe,
  KeyRound,
  LogIn,
  MessageSquareText,
  Plug,
  Sprout,
  TriangleAlert,
  UserPlus,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { Badge } from "@/components/arc/badge/badge"
import { BarChart } from "@/components/arc/bar-chart/bar-chart"
import { MetricCard } from "@/components/arc/metric-card/metric-card"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { type DataColumn, SortableDataTable } from "@/components/arc/sortable-data-table/sortable-data-table"
import { Timeline, type TimelineEvent } from "@/components/arc/timeline/timeline"
import { Card, Grid, Page } from "@/components/merchant/page"
import type { AdminStats } from "@/lib/admin"
import { SeedingActions } from "./seeding-actions"
import styles from "./views.module.css"

type Merchants = NonNullable<AdminStats["merchants"]>
type Person = AdminStats["people"][number]
type Account = NonNullable<Merchants["accounts"]>[number]

const number = (value: number) => value.toLocaleString("en-US")
const count = (value: number, one: string, other = `${one}s`) =>
  `${number(value)} ${value === 1 ? one : other}`
// Small daily counts average below 1, so they keep one decimal.
const chartValue = (value: number) =>
  Number.isInteger(value) || value >= 10 ? number(Math.round(value)) : value.toFixed(1)

const dayLabel = (day: string, style: "short" | "long" = "short") =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    ...(style === "long" && { weekday: "short" }),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

function ago(iso: string, now: number) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 30 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`
  return shortDate(iso)
}

const generated = (stats: AdminStats) => Date.parse(stats.generated_at)

function Metrics({ children }: { children: ReactNode }) {
  return <div className={styles.metrics}>{children}</div>
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

const SERIES = {
  active: "Active agents",
  signups: "Agent sign-ups",
  reviews: "Reviews",
  requests: "API requests",
  providers: "Provider sign-ups",
} as const
type Series = keyof typeof SERIES

export function OverviewView({ stats }: { stats: AdminStats }) {
  const [series, setSeries] = useState<Series>("active")
  const m = stats.merchants?.totals
  const providerDays = new Map((stats.merchants?.daily ?? []).map((row) => [row.day, row.signups]))
  const last = stats.daily.length - 1
  const data = stats.daily.map((row, i) => ({
    key: row.day,
    label: dayLabel(row.day, "long"),
    axisLabel: i === 0 || i === last || i % 7 === 0 ? (i === last ? "Today" : dayLabel(row.day)) : undefined,
    value: series === "providers" ? (providerDays.get(row.day) ?? 0) : row[series],
  }))
  const t = stats.totals
  return (
    <Page
      title="Overview"
      description={`Agents and API providers on 402reviews. Updated ${new Date(stats.generated_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}; days are UTC.`}
    >
      <Metrics>
        <MetricCard label="Active today" value={stats.active.dau} context="Agents that signed in, called the API or reviewed" />
        <MetricCard label="Active this week" value={stats.active.wau} context="Last 7 days" />
        <MetricCard label="Active this month" value={stats.active.mau} context="Last 30 days" />
        <MetricCard label="Active ever" value={stats.active.tau} context={count(t.users, "account")} />
      </Metrics>
      <Metrics>
        <MetricCard label="Reviews" value={t.reviews} context={`${number(t.reviews_last_7_days)} this week, ${number(t.reviews_seeded)} seeded`} />
        <MetricCard label="Agent sign-ups" value={t.users} context={`${number(t.users_last_7_days)} this week`} />
        <MetricCard label="API providers" value={m?.merchants ?? 0} context={`${number(m?.merchants_last_7_days ?? 0)} new this week, ${count(m?.verified ?? 0, "API")} verified`} />
        <MetricCard label="API requests" value={t.requests_last_30_days} context={`Last 30 days, ${number(t.anonymous_requests_last_30_days)} without an account`} />
      </Metrics>

      <Card
        title="Last 30 days"
        actions={
          <div className={styles.scrollX}>
            <SegmentedControl
              label="What to chart"
              value={series}
              onValueChange={(value) => setSeries(value as Series)}
              options={(Object.keys(SERIES) as Series[]).map((key) => ({ value: key, label: SERIES[key] }))}
            />
          </div>
        }
      >
        <BarChart
          data={data}
          label={SERIES[series]}
          period={`${dayLabel(stats.daily[0].day)} to today`}
          averageLabel="Daily average"
          valueLabel={SERIES[series]}
          height={200}
          formatValue={chartValue}
        />
      </Card>

      <Grid columns="2-1" align="start">
        <Card title="API requests by kind" description="Last 30 days">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Signed in</th>
                <th>Anonymous</th>
              </tr>
            </thead>
            <tbody>
              {stats.requests_by_kind.map((row) => (
                <tr key={row.kind}>
                  <td>{KIND_NAMES[row.kind] ?? row.kind}</td>
                  <td>{number(row.signed_in)}</td>
                  <td>{number(row.anonymous)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Top clients" description="Last 7 days, by request">
          {stats.clients.length ? (
            <ul className={styles.bars}>
              {stats.clients.map((row) => (
                <li key={row.client}>
                  <span className={styles.barLabel}>
                    <code>{row.client}</code>
                    <span>{number(row.requests)}</span>
                  </span>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.barFill}
                      style={{ width: `${(row.requests / Math.max(...stats.clients.map((c) => c.requests))) * 100}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No requests yet.</p>
          )}
        </Card>
      </Grid>
    </Page>
  )
}

export function AgentsView({ stats }: { stats: AdminStats }) {
  const now = generated(stats)
  const t = stats.totals
  const columns: DataColumn<Person>[] = [
    {
      key: "email",
      label: "Email",
      sortable: true,
      render: (value, row) => (
        <span className={styles.who}>
          {String(value)}
          {row.seeded_reviews > 0 && (
            <Badge size="sm" tone="neutral">
              Seed
            </Badge>
          )}
        </span>
      ),
    },
    { key: "signed_up_at", label: "Signed up", sortable: true, render: (value) => shortDate(String(value)) },
    { key: "last_active_at", label: "Last active", sortable: true, render: (value) => ago(String(value), now) },
    { key: "reviews", label: "Reviews", sortable: true, numeric: true },
    { key: "failure_reports", label: "Failure reports", sortable: true, numeric: true },
    { key: "requests", label: "Requests", sortable: true, numeric: true },
    {
      key: "auto_review",
      label: "Auto-review",
      sortable: true,
      render: (value) => (value ? "On" : "Off"),
    },
  ]
  return (
    <Page title="Agents" description="People who signed up to review, most recently active first.">
      <Metrics>
        <MetricCard label="Accounts" value={t.users} context={`${number(t.users_last_7_days)} this week`} />
        <MetricCard label="Auto-review on" value={t.auto_review_on} context="Review after every paid call" />
        <MetricCard label="Reviews" value={t.reviews} context={`${number(t.reviews_without_account)} without an account`} />
        <MetricCard label="Failure reports" value={t.failure_reports} context="Payments that failed without a charge" />
      </Metrics>
      <Card title="Everyone" flush>
        <div className={styles.flushTable}>
          <SortableDataTable
            rows={stats.people as unknown as (Person & Record<string, unknown>)[]}
            columns={columns as unknown as DataColumn<Person & Record<string, unknown>>[]}
            rowKey="email"
            caption="Agent accounts"
            itemName={{ one: "account", other: "accounts" }}
            defaultSort={{ key: "last_active_at", direction: "desc" }}
            emptyMessage="No one has signed up yet."
          />
        </div>
      </Card>
    </Page>
  )
}

const SEED_TONE = { open: "info", seeded: "success", declined: "danger" } as const

function SeedingQueue({ merchants, now }: { merchants: Merchants; now: number }) {
  const requests = [...merchants.seeding_requests].sort(
    (a, b) => Number(b.status === "open") - Number(a.status === "open") || b.created_at.localeCompare(a.created_at)
  )
  return (
    <Card
      title="Seeding requests"
      description={
        requests.length
          ? `${requests.filter((r) => r.status === "open").length} open. We pay for a few calls and post honest reviews.`
          : "Requests show here when a provider asks."
      }
    >
      {requests.length === 0 ? (
        <p className={styles.muted}>None yet.</p>
      ) : (
        <ul className={styles.requests}>
          {requests.map((request) => (
            <li key={request.id}>
              <div className={styles.requestHead}>
                <span className={styles.requestWho}>
                  <code>{request.domain}</code>
                  <span>
                    {request.email}, {ago(request.created_at, now)}
                  </span>
                </span>
                <Badge size="sm" tone={SEED_TONE[request.status]}>
                  {request.status === "open" ? "Open" : request.status === "seeded" ? "Seeded" : "Declined"}
                </Badge>
              </div>
              {request.endpoints.length ? (
                <ul className={styles.endpoints}>
                  {request.endpoints.map((endpoint) => (
                    <li key={endpoint.url}>
                      <code>{endpoint.url}</code>
                      <span>${endpoint.price_usd} a call</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>No endpoints listed. Pick a few that cost $0.05 or less a call.</p>
              )}
              {request.notes && <p className={styles.notes}>{request.notes}</p>}
              <SeedingActions id={request.id} status={request.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const VIA: Record<string, string> = { email: "with an email code", google: "with Google" }

// One provider action as a timeline row.
function providerEvent(event: NonNullable<Merchants["events"]>[number], i: number): TimelineEvent {
  const base = { id: `m${i}-${event.at}`, at: event.at, actor: event.email }
  const domain = event.domain ?? "a domain"
  switch (event.kind) {
    case "signed_in":
      return { ...base, title: "signed in", meta: VIA[event.detail ?? ""] ?? undefined, icon: <LogIn size={14} /> }
    case "claimed":
      return { ...base, title: `claimed ${domain}`, icon: <Globe size={14} /> }
    case "verified":
      return {
        ...base,
        title: `verified ${domain}`,
        meta: event.detail === "dns" ? "With a DNS record" : event.detail === "file" ? "With a file" : undefined,
        icon: <BadgeCheck size={14} />,
        tone: "success",
      }
    case "profile_saved":
      return { ...base, title: `updated the profile for ${domain}`, icon: <FileText size={14} /> }
    case "seeding_requested":
      return { ...base, title: `asked us to seed ${domain}`, meta: event.detail ?? undefined, icon: <Sprout size={14} /> }
    case "key_created":
      return { ...base, title: "created an API key", icon: <KeyRound size={14} /> }
    case "key_revoked":
      return { ...base, title: "revoked a key or app", icon: <KeyRound size={14} /> }
    case "app_connected":
      return { ...base, title: `connected ${event.detail ?? "an app"} to the providers MCP`, icon: <Plug size={14} />, tone: "success" }
    case "refund_attached":
      return { ...base, title: `attached a refund to a review of ${domain}`, meta: event.detail ?? undefined, icon: <BadgeCheck size={14} />, tone: "success" }
    case "app_refused":
      return { ...base, title: "couldn't connect an app to the providers MCP", meta: event.detail ?? undefined, icon: <Plug size={14} />, tone: "danger" }
    case "seeding_updated":
      return { ...base, title: `changed the endpoints to seed on ${domain}`, meta: event.detail ?? undefined, icon: <Sprout size={14} /> }
    default:
      return { ...base, title: event.kind.replaceAll("_", " "), icon: <Globe size={14} /> }
  }
}

function agentEvent(event: AdminStats["activity"][number], i: number): TimelineEvent {
  const base = { id: `a${i}-${event.at}`, at: event.at, actor: event.who ?? "Someone" }
  if (event.type === "signup") return { ...base, title: "signed up to review", icon: <UserPlus size={14} /> }
  if (event.type === "failure_report") {
    return {
      ...base,
      title: `reported a failed payment to ${event.title}`,
      meta: event.detail ?? undefined,
      icon: <TriangleAlert size={14} />,
      tone: "danger",
    }
  }
  return {
    ...base,
    title: `reviewed ${event.title}`,
    meta: [event.detail, event.seeded ? "seeded" : null].filter(Boolean).join(" · ") || undefined,
    icon: <MessageSquareText size={14} />,
  }
}

export function ProvidersView({ stats }: { stats: AdminStats }) {
  const now = generated(stats)
  const merchants = stats.merchants ?? { claims: [], seeding_requests: [] }
  const m = merchants.totals
  const columns: DataColumn<Account>[] = [
    { key: "email", label: "Email", sortable: true },
    { key: "first_seen_at", label: "Joined", sortable: true, render: (value) => shortDate(String(value)) },
    { key: "last_active_at", label: "Last active", sortable: true, render: (value) => ago(String(value), now) },
    {
      key: "apis",
      label: "APIs",
      render: (_, row) =>
        row.apis.length ? (
          <span className={styles.chips}>
            {row.apis.map((api) => (
              <Badge key={api.domain} size="sm" tone={api.status === "verified" ? "success" : "neutral"} dot={api.status === "verified"}>
                {api.domain}
              </Badge>
            ))}
          </span>
        ) : (
          <span className={styles.muted}>None</span>
        ),
    },
    {
      key: "apps",
      label: "Agent connected",
      render: (_, row) =>
        row.apps.length || row.keys ? (
          [...row.apps, ...(row.keys ? [`${row.keys} key${row.keys === 1 ? "" : "s"}`] : [])].join(", ")
        ) : (
          <span className={styles.muted}>No</span>
        ),
    },
    { key: "seeding_requests", label: "Seeding", sortable: true, numeric: true },
    { key: "actions", label: "Actions", sortable: true, numeric: true },
  ]
  return (
    <Page title="API providers" description="Who claimed an API, what they did, and seeding requests to handle.">
      <Metrics>
        <MetricCard label="Providers" value={m?.merchants ?? 0} context={`${number(m?.merchants_last_7_days ?? 0)} new this week`} />
        <MetricCard label="Verified APIs" value={m?.verified ?? 0} context={`${number(m?.pending ?? 0)} still verifying`} />
        <MetricCard label="Agents connected" value={m?.connected_apps ?? 0} context={`Apps signed in to the providers MCP, plus ${count(m?.keys ?? 0, "key")}`} />
        <MetricCard label="Open seeding" value={m?.seeding_open ?? 0} context="Requests waiting on us" />
      </Metrics>

      <SeedingQueue merchants={merchants} now={now} />

      <Card title="Providers" flush>
        <div className={styles.flushTable}>
          <SortableDataTable
            rows={(merchants.accounts ?? []) as unknown as (Account & Record<string, unknown>)[]}
            columns={columns as unknown as DataColumn<Account & Record<string, unknown>>[]}
            rowKey="email"
            caption="API providers"
            itemName={{ one: "provider", other: "providers" }}
            defaultSort={{ key: "last_active_at", direction: "desc" }}
            emptyMessage="No providers yet."
          />
        </div>
      </Card>

      <Card title="What providers did" description="Sign-ins, claims, verifications, profiles, seeding and agent connections.">
        {merchants.events?.length ? (
          <Timeline
            events={merchants.events.map(providerEvent)}
            now={now}
            label="What providers did"
            maxHeight={560}
          />
        ) : (
          <p className={styles.muted}>Nothing logged yet. Actions show here from now on.</p>
        )}
      </Card>
    </Page>
  )
}

export function ActivityView({ stats }: { stats: AdminStats }) {
  const [who, setWho] = useState<"all" | "agents" | "providers">("all")
  const now = generated(stats)
  const agents = stats.activity.map(agentEvent)
  const providers = (stats.merchants?.events ?? []).map(providerEvent)
  const events = who === "agents" ? agents : who === "providers" ? providers : [...agents, ...providers]
  return (
    <Page title="Activity" description="Everything that happened, newest first.">
      <Card
        title="Feed"
        actions={
          <SegmentedControl
            label="Whose activity"
            value={who}
            onValueChange={(value) => setWho(value as typeof who)}
            options={[
              { value: "all", label: "Everyone" },
              { value: "agents", label: "Agents" },
              { value: "providers", label: "API providers" },
            ]}
          />
        }
      >
        {events.length ? (
          <Timeline key={who} events={events} now={now} label="Activity" />
        ) : (
          <p className={styles.muted}>Nothing yet.</p>
        )}
      </Card>
    </Page>
  )
}
