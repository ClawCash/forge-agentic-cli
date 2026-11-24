"use client"

import { AnimatedCounter } from "@/components/arc/animated-counter/animated-counter"

// A row of live totals above the leaderboard. Real counts only.
export function BoardStats({ items }: { items: { value: number; label: string }[] }) {
  return (
    <dl className="stat-tokens mx-auto mt-9 flex max-w-[640px] justify-center divide-x divide-line">
      {items.map(({ value, label }) => (
        <div key={label} className="flex flex-col items-center gap-1 px-5 sm:px-8 [--text-3xl:clamp(26px,3vw,32px)]">
          <dd>
            <AnimatedCounter value={value} animateOnView />
          </dd>
          <dt className="text-center text-[12.5px] text-muted">{label}</dt>
        </div>
      ))}
    </dl>
  )
}
