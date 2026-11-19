import type { Metadata } from "next"
import { cookies } from "next/headers"
import { ADMIN_COOKIE, loadStats } from "@/lib/admin"
import { Dashboard } from "./dashboard"
import { AdminSignIn } from "./sign-in"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Admin: 402reviews",
  robots: { index: false, follow: false },
}

export default async function AdminPage() {
  const result = await loadStats((await cookies()).get(ADMIN_COOKIE)?.value)
  if (result.state === "signed-out") return <AdminSignIn />
  if (result.state === "error") {
    return (
      <main className="flex min-h-svh items-center justify-center bg-paper px-4">
        <div className="panel max-w-[380px] p-7 text-[14px]">
          <p className="font-medium">Couldn&apos;t load the dashboard</p>
          <p className="mt-1 text-muted">
            {result.message}. Reload to try again.
          </p>
        </div>
      </main>
    )
  }
  return <Dashboard stats={result.stats} />
}
