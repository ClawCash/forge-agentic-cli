"use client"

import { type CSSProperties, useEffect, useRef } from "react"
import { Star } from "@/components/ui"

// Stars twinkling around the headline. Positions stay clear of the text.
const TWINKLES = [
  { left: "7%", top: "20%", size: "size-5", tone: "text-accent", d: 0, t: 5 },
  { left: "15%", top: "58%", size: "size-3", tone: "text-ink", d: 900, t: 6 },
  { left: "4%", top: "76%", size: "size-4", tone: "text-faint", d: 1700, t: 7 },
  {
    left: "22%",
    top: "12%",
    size: "size-3",
    tone: "text-faint",
    d: 2300,
    t: 6,
  },
  { left: "90%", top: "16%", size: "size-4", tone: "text-faint", d: 500, t: 6 },
  { left: "82%", top: "34%", size: "size-3", tone: "text-ink", d: 1400, t: 5 },
  {
    left: "93%",
    top: "60%",
    size: "size-5",
    tone: "text-accent",
    d: 2000,
    t: 7,
  },
  { left: "78%", top: "80%", size: "size-3", tone: "text-faint", d: 300, t: 6 },
]

// The hero backdrop: a dot grid that lights up orange around the pointer.
export function HeroField() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const field = ref.current
    const host = field?.parentElement
    if (!field || !host) return
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const hover = window.matchMedia("(hover: hover)").matches
    if (calm || !hover) return

    let frame = 0
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = host.getBoundingClientRect()
        field.style.setProperty("--mx", `${event.clientX - box.left}px`)
        field.style.setProperty("--my", `${event.clientY - box.top}px`)
        field.style.setProperty("--lit", "1")
      })
    }
    const leave = () => field.style.setProperty("--lit", "0")
    host.addEventListener("pointermove", move)
    host.addEventListener("pointerleave", leave)
    return () => {
      cancelAnimationFrame(frame)
      host.removeEventListener("pointermove", move)
      host.removeEventListener("pointerleave", leave)
    }
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      <div className="dots absolute inset-0" />
      <div className="dots-lit absolute inset-0" />
      {TWINKLES.map((star, i) => (
        <span
          key={i}
          className={`twinkle ${star.tone} ${i % 2 ? "hidden sm:block" : ""}`}
          style={
            {
              left: star.left,
              top: star.top,
              "--d": `${star.d}ms`,
              "--t": `${star.t}s`,
            } as CSSProperties
          }
        >
          <Star className={star.size} />
        </span>
      ))}
    </div>
  )
}
