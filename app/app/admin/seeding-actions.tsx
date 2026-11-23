"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

const LABEL: Record<string, string> = {
  open: "Open",
  seeded: "Seeded",
  declined: "Declined",
}

// Marks a merchant's seeding request done or declined.
export function SeedingActions({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function set(next: string) {
    setBusy(true)
    await fetch("/admin/seeding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    }).catch(() => null)
    setBusy(false)
    router.refresh()
  }
  if (status !== "open") {
    return (
      <span className="flex items-center gap-3 text-[12px] text-muted">
        {LABEL[status] ?? status}
        <button
          type="button"
          disabled={busy}
          onClick={() => set("open")}
          className="hover:text-ink"
        >
          Reopen
        </button>
      </span>
    )
  }
  const button =
    "h-7 rounded-[7px] border border-line bg-white px-2.5 text-[12px] font-medium hover:border-faint disabled:opacity-50"
  return (
    <span className="flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => set("seeded")}
        className={button}
      >
        Mark seeded
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => set("declined")}
        className={`${button} text-muted`}
      >
        Decline
      </button>
    </span>
  )
}
