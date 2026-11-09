"use client"

import { X } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ApiDetails, ApiHeading } from "@/components/api-details"
import {
  getServiceReviews,
  type LeaderboardEntry,
  type ServiceReview,
} from "@/lib/leaderboard"

export function ApiDrawer({
  entry,
  onClose,
}: {
  entry: LeaderboardEntry
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [leaving, setLeaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [reviews, setReviews] = useState<ServiceReview[] | null>(null)
  const [failed, setFailed] = useState(false)
  const name = entry.name ?? entry.domain

  useEffect(() => {
    const controller = new AbortController()
    getServiceReviews(entry.domain, controller.signal)
      .then((loaded) => {
        setReviews(loaded)
        setFailed(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [entry.domain, attempt])

  // Holds the page still, and hands focus back to the card on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButton.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      opener?.focus()
    }
  }, [])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") setLeaving(true)
    if (event.key !== "Tab") return
    const focusable =
      panel.current?.querySelectorAll<HTMLElement>("a, button, summary")
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <div
        data-leaving={leaving}
        className="drawer-backdrop absolute inset-0 bg-ink/30"
        onClick={() => setLeaving(true)}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Reviews of ${name}`}
        data-leaving={leaving}
        onAnimationEnd={(event) => {
          if (leaving && event.target === panel.current) onClose()
        }}
        className="drawer absolute inset-y-0 right-0 flex w-full flex-col bg-white sm:w-[500px] sm:border-l sm:border-line"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
          <ApiHeading entry={entry} />
          <a
            href={`/s/${entry.domain}`}
            className="mt-0.5 shrink-0 text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Full page
          </a>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close"
            onClick={() => setLeaving(true)}
            className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-paper hover:text-ink focus-visible:bg-paper focus-visible:outline-none"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <ApiDetails
            entry={entry}
            reviews={reviews}
            failed={failed}
            onRetry={() => {
              setFailed(false)
              setAttempt(attempt + 1)
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
