"use client"

import { Check } from "lucide-react"
import { useState } from "react"
import { LIVE, LIVE_REVIEW } from "@/lib/live"
import { TextLink } from "./ui"

function Stars({ value }: { value: number }) {
  // Scores are 0–100 onchain; five stars at 20 points each.
  const filled = Math.round(value / 20)
  return (
    <div className="flex items-center gap-1" aria-label={`${value} out of 100`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          className={`size-[18px] ${i < filled ? "fill-ink" : "fill-line"}`}
          aria-hidden="true"
        >
          <path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
        </svg>
      ))}
      <span className="ml-2 font-mono text-[11px] text-muted">
        {value} / 100
      </span>
    </div>
  )
}

export function ReviewCard() {
  const [view, setView] = useState<"review" | "json">("review")
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] text-muted">
          Short enough to read. Specific enough to use.
        </span>
        <div className="flex rounded-[6px] border border-line bg-paper p-0.5 font-mono text-[10px]">
          {(["review", "json"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-[4px] px-2.5 py-1 ${view === v ? "bg-white text-ink shadow-sm" : "text-faint"}`}
            >
              {v === "review" ? "Review" : "JSON"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-[12px] border border-line bg-white p-6 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.25)]">
        {view === "review" ? (
          <div className="fade-in">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-[8px] border border-line bg-paper text-[13px] font-semibold">
                  A
                </div>
                <div>
                  <div className="text-[14px] font-medium">
                    {LIVE_REVIEW.service}
                  </div>
                  <div className="text-[11px] text-faint">
                    Invoice extraction · Hindi · agent {LIVE.apiA.agentId}
                  </div>
                </div>
              </div>
              <span className="rounded-[4px] border border-bad/30 bg-[#fcf2f0] px-2 py-0.5 text-[10px] text-bad">
                Failure
              </span>
            </div>
            <div className="mt-5">
              <Stars value={LIVE_REVIEW.value} />
            </div>
            <p className="mt-4 text-[17px] leading-snug tracking-[-0.01em]">
              &ldquo;{LIVE_REVIEW.reason}.&rdquo;
            </p>
            <code className="mt-4 inline-block rounded-[4px] border border-line bg-paper px-2 py-1 font-mono text-[10px] text-muted">
              {LIVE_REVIEW.task}
            </code>
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-4 text-[10px] text-ok">
              <span className="flex items-center gap-1">
                <Check className="size-3" /> Payment-backed
              </span>
              <span className="flex items-center gap-1">
                <Check className="size-3" /> Human-approved reviewer (World ID)
              </span>
              <span className="flex items-center gap-1">
                <Check className="size-3" /> Onchain on Hedera
              </span>
            </div>
          </div>
        ) : (
          <pre className="fade-in max-h-[300px] overflow-auto font-mono text-[11px] leading-relaxed text-muted">
            {JSON.stringify(LIVE_REVIEW.json, null, 2)}
          </pre>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-4 font-mono text-[10px] text-faint">
        <TextLink href={LIVE.reviews.humanApproved.document}>
          Review document
        </TextLink>
        <TextLink href={LIVE.reviews.humanApproved.tx}>
          Live on Hedera testnet
        </TextLink>
      </div>
    </div>
  )
}
