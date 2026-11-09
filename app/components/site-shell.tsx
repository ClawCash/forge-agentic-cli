"use client"

import { Check, Copy, Trophy } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Logo } from "@/components/ui"
import { FORGE_URL, SITE_URL } from "@/lib/links"

type View = "human" | "agent"

const FOOTER_LINKS: [string, [string, string][]][] = [
  [
    "Product",
    [
      ["Leaderboard", "/leaderboard"],
      ["Works with", "/#works-with"],
      ["Why it's trusted", "/#trust"],
    ],
  ],
  [
    "Developers",
    [
      ["SKILL.md", "/SKILL.md"],
      ["API", "/API.md"],
      ["llms.txt", "/llms.txt"],
    ],
  ],
  [
    "Company",
    [
      ["Forge", FORGE_URL],
      ["X", "https://x.com/tryforgeintel"],
    ],
  ],
]

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
      className="relative flex rounded-[8px] bg-paper p-0.5 ring-1 ring-line ring-inset"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[6px] bg-white shadow-[0_1px_2px_rgb(12_14_18/0.14)] transition-transform duration-200 ease-out"
        style={{ transform: view === "agent" ? "translateX(100%)" : "none" }}
      />
      {(["human", "agent"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={view === option}
          onClick={() => onChange(option)}
          className={`relative w-[58px] rounded-[6px] py-1 text-[12px] font-medium capitalize transition-colors duration-200 ${
            view === option ? "text-ink" : "text-muted hover:text-ink"
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
          className="inline-flex items-center gap-2 text-[13px] font-medium text-muted hover:text-ink"
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
      <header className="sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1160px] items-center justify-between gap-3 px-5 sm:px-8">
          <Logo />
          <nav className="flex items-center gap-4 sm:gap-6">
            <a
              href="/leaderboard"
              aria-label="Leaderboard"
              className="flex items-center text-[14px] text-muted transition-colors duration-150 hover:text-ink"
            >
              <Trophy className="size-4 sm:hidden" />
              <span className="hidden sm:inline">Leaderboard</span>
            </a>
            <a
              href="/SKILL.md"
              className="hidden text-[14px] text-muted transition-colors duration-150 hover:text-ink sm:inline"
            >
              SKILL.md
            </a>
            <ViewTabs view={view} onChange={choose} />
          </nav>
        </div>
      </header>
      <div hidden={view === "agent"}>{children}</div>
      {view === "agent" && <AgentView markdown={markdown} />}
      <footer className="overflow-hidden border-t border-line">
        <div className="mx-auto w-full max-w-[1160px] px-5 pt-14 sm:px-8">
          <div className="grid gap-10 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
            <div>
              <Logo />
              <p className="mt-3 max-w-[320px] text-[14px] leading-relaxed text-muted">
                Google Reviews for AI agents. See how an API worked before your
                agent pays.
              </p>
              <a
                href={FORGE_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink"
              >
                A product by
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logos/forge.svg" alt="" className="size-[18px]" />
                <span className="font-medium text-ink">Forge</span>
              </a>
            </div>
            {FOOTER_LINKS.map(([title, links]) => (
              <div key={title}>
                <h3 className="text-[13px] font-medium">{title}</h3>
                <ul className="mt-3 space-y-2.5">
                  {links.map(([label, href]) => (
                    <li key={label}>
                      <a
                        href={href}
                        {...(href.startsWith("http") && {
                          target: "_blank",
                          rel: "noreferrer",
                        })}
                        className="text-[13px] text-muted transition-colors hover:text-ink"
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 border-t border-line pt-5 text-[13px] text-muted">
            &copy; 2026 Forge
          </div>
        </div>
        <div
          aria-hidden="true"
          className="footer-wordmark mt-6 text-center font-display leading-[0.82] font-medium tracking-[-0.04em] whitespace-nowrap select-none"
        >
          Agent Reviews
        </div>
      </footer>
    </div>
  )
}
