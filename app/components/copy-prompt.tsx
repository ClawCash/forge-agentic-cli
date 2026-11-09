"use client"

import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"
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

export function CopyPrompt({ dark = false }: { dark?: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2200)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <div
      className={`flex w-full flex-col gap-3 rounded-[10px] border p-3 text-left sm:flex-row sm:items-center sm:py-2 sm:pr-2 sm:pl-4 ${
        dark
          ? "border-white/15 bg-white/[0.06]"
          : "border-line bg-white shadow-[0_1px_2px_rgb(12_14_18/0.05)]"
      }`}
    >
      <code
        className={`min-w-0 flex-1 font-mono text-[12px] leading-snug break-words sm:text-[13px] ${
          dark ? "text-white/90" : "text-ink"
        }`}
      >
        {SKILL_PROMPT}
      </code>
      <button
        type="button"
        onClick={async () => setCopied(await copyText(SKILL_PROMPT))}
        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-[7px] px-4 py-2.5 text-[13px] font-medium transition-colors duration-150 ${
          dark
            ? "bg-white text-ink hover:bg-white/90"
            : "bg-ink text-white hover:bg-[#2a2e36]"
        }`}
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  )
}
