"use client"

import { Check, Copy } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useEffect, useState } from "react"

// The docs' table of contents. A bar beside it follows the section you're
// reading.
export function DocsNav({ sections }: { sections: { id: string; title: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id)
  const reduce = !!useReducedMotion()

  // The section you're reading is the last one whose top has passed a line a
  // little below the header.
  useEffect(() => {
    let frame = 0
    function update() {
      frame = 0
      const line = 200
      let current = sections[0]?.id
      for (const { id } of sections) {
        const element = document.getElementById(id)
        if (element && element.getBoundingClientRect().top <= line) current = id
      }
      setActive(current)
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [sections])

  return (
    <ul className="relative mt-4 space-y-0.5 border-l border-line">
      {sections.map(({ id, title }) => (
        <li key={id} className="relative">
          {active === id && (
            <motion.span
              layoutId="docs-bar"
              aria-hidden="true"
              className="absolute top-0 bottom-0 -left-px w-[2px] rounded-full bg-ink"
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 40 }}
            />
          )}
          <a
            href={`#${id}`}
            aria-current={active === id ? "location" : undefined}
            className={`block py-1.5 pl-4 text-[14px] transition-colors duration-150 ${
              active === id ? "text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {title}
          </a>
        </li>
      ))}
    </ul>
  )
}

// A copy button on a code block, shown on hover or keyboard focus.
export function CodeCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
      }}
      aria-label={copied ? "Copied" : "Copy code"}
      className="press absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-[8px] border border-line bg-white text-muted opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
    >
      {copied ? <Check className="size-3.5 text-ok" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
    </button>
  )
}
