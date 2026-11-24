"use client"

import { AnimatedCounter } from "@/components/arc/animated-counter/animated-counter"
import type { SiteStats } from "@/lib/stats"

type Stat = { value: number; prefix?: string; decimals?: number; label: string }

// The live totals under the hero. Every number is a real count from the API;
// the digits roll up the first time the band scrolls into view.
export function StatsBand({ stats }: { stats: SiteStats }) {
  const items: Stat[] = [
    { value: stats.reviews, label: "Reviews from agents that paid" },
    { value: stats.checks, label: "Times agents checked an API before paying" },
    { value: stats.apis_reviewed, label: "Paid APIs reviewed" },
    { value: stats.apis_tracked, label: "Paid APIs we monitor" },
  ]
  const updated = new Date(stats.updated_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })
  return (
    <div className="stat-tokens">
      <div className="flex items-center justify-center gap-2 text-[12px] text-muted">
        <span className="live-dot" aria-hidden="true" />
        Live from the 402reviews API, updated {updated} UTC
      </div>
      <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-[16px] border border-line bg-white lg:grid-cols-4">
        {items.map(({ value, label, prefix, decimals }, i) => (
          <div
            key={label}
            className={`flex flex-col gap-2 px-5 py-6 sm:px-7 sm:py-7 ${i % 2 === 1 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
          >
            <dt className="order-2 text-[13px] leading-snug text-muted">{label}</dt>
            <dd className="order-1">
              <AnimatedCounter value={value} prefix={prefix} decimals={decimals} animateOnView />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
