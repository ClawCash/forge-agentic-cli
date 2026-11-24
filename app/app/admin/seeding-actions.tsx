"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/arc/button/button"
import styles from "./views.module.css"

// Marks a merchant's seeding request done or declined, or reopens it.
export function SeedingActions({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)

  async function set(next: string) {
    setBusy(next)
    setError(false)
    const res = await fetch("/admin/seeding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    }).catch(() => null)
    setBusy(null)
    if (!res?.ok) {
      setError(true)
      return
    }
    router.refresh()
  }

  return (
    <div className={styles.actions}>
      {status === "open" ? (
        <>
          <Button size="sm" onClick={() => set("seeded")} loading={busy === "seeded"} disabled={!!busy}>
            Mark seeded
          </Button>
          <Button size="sm" variant="secondary" onClick={() => set("declined")} loading={busy === "declined"} disabled={!!busy}>
            Decline
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => set("open")} loading={busy === "open"} disabled={!!busy}>
          Reopen
        </Button>
      )}
      {error && (
        <span className={styles.error} role="alert">
          Couldn&apos;t update it. Try again.
        </span>
      )}
    </div>
  )
}
