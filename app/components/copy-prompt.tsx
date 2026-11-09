"use client"

import { Check, Copy } from "lucide-react"
import { type CSSProperties, useEffect, useState } from "react"
import { Star } from "@/components/ui"
import { SKILL_PROMPT } from "@/lib/links"

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers and non-secure contexts: fall back to a hidden textarea.
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    area.remove()
    return ok
  }
}

// Where each star lands when the prompt is copied.
const BURST = [
  ["-46px", "-34px"],
  ["-20px", "-50px"],
  ["14px", "-52px"],
  ["44px", "-36px"],
  ["56px", "-6px"],
  ["-58px", "-4px"],
]

export function CopyPrompt() {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2200)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 rounded-[10px] border border-ink bg-white p-3 text-left shadow-[3px_4px_0_0_#141414] sm:flex-row sm:items-center sm:py-2 sm:pr-2 sm:pl-4">
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <span aria-hidden="true" className="font-mono text-[13px] text-accent">
          &gt;
        </span>
        <code className="min-w-0 flex-1 font-mono text-[11.5px] leading-snug break-words text-ink sm:text-[13px]">
          {SKILL_PROMPT}
        </code>
      </div>
      <button
        type="button"
        onClick={async () => setCopied(await copyText(SKILL_PROMPT))}
        className={`relative inline-flex shrink-0 items-center justify-center gap-2 rounded-[6px] px-4 py-2.5 text-[13px] font-medium text-white transition-all duration-200 active:scale-95 ${
          copied ? "bg-accent" : "bg-ink hover:bg-[#2b2b2b]"
        }`}
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied &&
          BURST.map(([x, y], i) => (
            <span
              key={i}
              aria-hidden="true"
              className="burst-star text-accent"
              style={
                { "--x": x, "--y": y, "--d": `${i * 25}ms` } as CSSProperties
              }
            >
              <Star className="size-3" />
            </span>
          ))}
      </button>
    </div>
  )
}
