"use client"

import { Check, Copy, Trophy } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Logo, TextLink } from "@/components/ui"
import { FORGE_URL, REPO_URL, SITE_URL } from "@/lib/links"

type View = "human" | "agent"

function ViewTabs({
  view,
  onChange,
}: {
  view: View
  onChange: (view: View) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="View this page as"
      className="relative flex rounded-full border border-line bg-white p-0.5"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-ink transition-transform duration-300 ease-out"
        style={{ transform: view === "agent" ? "translateX(100%)" : "none" }}
      />
      {(["human", "agent"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={view === option}
          onClick={() => onChange(option)}
          className={`relative w-[58px] rounded-full py-1 text-[12px] font-medium capitalize transition-colors duration-300 ${
            view === option ? "text-white" : "text-muted hover:text-ink"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function AgentView({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <main className="fade-up mx-auto w-full max-w-[780px] px-4 pt-8 pb-20 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <div className="label">This page as markdown</div>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(markdown)
            setCopied(true)
          }}
          className="inline-flex items-center gap-2 text-[13px] font-medium hover:text-accent"
        >
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
      <pre className="mt-4 overflow-x-auto rounded-[12px] border border-line bg-paper p-5 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap sm:p-6">
        {markdown}
      </pre>
      <p className="mt-4 font-mono text-[11.5px] leading-relaxed break-words text-muted">
        curl -H &quot;Accept: text/markdown&quot; {SITE_URL}
      </p>
    </main>
  )
}

// The nav, the Human/Agent switch and the footer, shared by every page.
export function SiteShell({
  markdown,
  children,
}: {
  markdown: string
  children: ReactNode
}) {
  const [view, setView] = useState<View>("human")

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "agent") {
      setView("agent")
    }
  }, [])

  function choose(next: View) {
    setView(next)
    const url = new URL(window.location.href)
    if (next === "agent") url.searchParams.set("view", "agent")
    else url.searchParams.delete("view")
    window.history.replaceState(null, "", url)
  }

  return (
    <div id="top">
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-[68px] w-full max-w-[1120px] items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-3 sm:gap-5">
            <a
              href="/leaderboard"
              aria-label="Leaderboard"
              className="flex items-center text-[13px] text-muted transition-colors hover:text-accent"
            >
              <Trophy className="size-4 sm:hidden" />
              <span className="hidden sm:inline">Leaderboard</span>
            </a>
            <a
              href="/SKILL.md"
              className="hidden font-mono text-[13px] text-muted transition-colors hover:text-accent sm:inline"
            >
              SKILL.md
            </a>
            <ViewTabs view={view} onChange={choose} />
          </nav>
        </div>
      </header>
      <div hidden={view === "agent"}>{children}</div>
      {view === "agent" && <AgentView markdown={markdown} />}
      <footer className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-4 border-t border-line px-4 py-8 text-[12px] text-muted sm:px-6">
        <span>
          A project by <TextLink href={FORGE_URL}>Forge</TextLink>
        </span>
        <TextLink href={REPO_URL}>View the code</TextLink>
      </footer>
    </div>
  )
}
