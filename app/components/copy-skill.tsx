"use client"

import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"
import { REPO_URL } from "@/lib/live"

// What the button copies: a prompt to paste into a coding agent (Claude Code,
// Codex, …) so it installs the skill and uses it before paying for x402 APIs.
export const SKILL_PROMPT = `Set up the Agent Reviews skill from ${REPO_URL}:
1. If this folder is not already a clone of it: git clone ${REPO_URL}.git && cd forge-agentic-cli. Then run npm install.
2. Copy skills/agent-reviews into your skills folder (for Claude Code: ~/.claude/skills/).
3. Follow skills/agent-reviews/SKILL.md whenever a task needs a paid x402 API: check reviews and ask me before paying, and offer to leave a review afterwards.`

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

export function CopySkillButton({
  variant = "solid",
}: {
  variant?: "solid" | "outline"
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const styles =
    variant === "solid"
      ? "bg-ink text-white shadow-[2px_3px_0_0_#000]"
      : "border border-ink bg-white text-ink shadow-[2px_3px_0_0_#141414] hover:bg-paper"
  return (
    <button
      type="button"
      onClick={async () => setCopied(await copyText(SKILL_PROMPT))}
      title="Copies a prompt for your coding agent"
      className={`inline-flex items-center gap-6 rounded-[5px] px-5 py-3 text-[13px] font-medium transition-transform active:translate-y-[2px] active:shadow-none ${styles}`}
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy agent skill"}</span>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}
