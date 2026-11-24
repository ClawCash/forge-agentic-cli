import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Alert } from "@/components/arc/alert/alert"
import { MerchantShell, type NavEntry, type NavSection } from "@/components/merchant/shell"
import { ADMIN_COOKIE, loadStats } from "@/lib/admin"
import { APP_URL, SITE_URL } from "@/lib/links"
import { SignIn } from "../merchants/sign-in"
import { ActivityView, AgentsView, OverviewView, ProvidersView } from "./views"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Admin: 402reviews",
  robots: { index: false, follow: false },
}

const VIEWS = {
  overview: { label: "Overview", kind: "overview" },
  agents: { label: "Agents", kind: "people" },
  providers: { label: "API providers", kind: "providers" },
  activity: { label: "Activity", kind: "activity" },
} as const
type View = keyof typeof VIEWS

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view: asked } = await searchParams
  const result = await loadStats((await cookies()).get(ADMIN_COOKIE)?.value)
  if (result.state === "signed-out") {
    return (
      <SignIn
        tag="admin"
        title="Sign in to admin"
        intro="For the 402reviews team. We'll email you a code."
        endpoints={{ start: "/admin/start", verify: "/admin/verify" }}
      />
    )
  }
  if (result.state === "error") {
    return (
      <main style={{ display: "grid", minHeight: "100svh", placeItems: "center", padding: "var(--space-4)" }}>
        <Alert tone="danger" title="Couldn't load the dashboard">
          {result.message}. Reload to try again.
        </Alert>
      </main>
    )
  }

  const { stats } = result
  const view: View = asked && asked in VIEWS ? (asked as View) : "overview"
  const sections: NavSection[] = [
    {
      id: "admin",
      items: (Object.keys(VIEWS) as View[]).map((id) => ({
        id,
        label: VIEWS[id].label,
        href: id === "overview" ? "?" : `?view=${id}`,
        kind: VIEWS[id].kind,
      })),
    },
  ]
  const footer: NavEntry[] = [
    { id: "site", label: "402reviews.xyz", href: SITE_URL, kind: "external" },
    { id: "app", label: "Provider app", href: APP_URL, kind: "external" },
  ]

  return (
    <MerchantShell
      email={stats.admin_email ?? "Admin"}
      sections={sections}
      footer={footer}
      active={view}
      crumb={VIEWS[view].label}
      product="Admin"
      home="Admin"
      logoutAction="/admin/logout"
    >
      {view === "overview" && <OverviewView stats={stats} />}
      {view === "agents" && <AgentsView stats={stats} />}
      {view === "providers" && <ProvidersView stats={stats} />}
      {view === "activity" && <ActivityView stats={stats} />}
    </MerchantShell>
  )
}
