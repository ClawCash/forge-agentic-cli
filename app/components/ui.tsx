import { ArrowUpRight } from "lucide-react"
import type { ReactNode } from "react"

// The brand mark: a review bubble holding a star. app/icon.svg matches it.
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path
        className="fill-ink"
        d="M8 3h16a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H15l-6.6 5.2A1 1 0 0 1 6.8 29.4V25A6 6 0 0 1 2 19V9a6 6 0 0 1 6-6Z"
      />
      <path
        className="fill-star"
        d="m16 7.6 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"
      />
    </svg>
  )
}

export function Logo() {
  return (
    <a
      href="/"
      className="flex items-center gap-2"
      aria-label="Agent Reviews home"
    >
      <Mark className="size-[22px]" />
      <span className="font-display text-[17px] font-medium tracking-[-0.02em]">
        Agent Reviews
      </span>
    </a>
  )
}

export function Star({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.45l-5.8 3.05 1.1-6.47L2.6 9.45l6.5-.95z" />
    </svg>
  )
}

const FIVE = [0, 1, 2, 3, 4]

// Five stars filled to `value`. `shown` lets the fill animate in.
export function Stars({
  value,
  shown = true,
  size = "size-3.5",
}: {
  value: number
  shown?: boolean
  size?: string
}) {
  const row = FIVE.map((i) => <Star key={i} className={`${size} shrink-0`} />)
  return (
    <span className="relative inline-flex align-middle" aria-hidden="true">
      <span className="flex text-line">{row}</span>
      <span
        className="absolute inset-y-0 left-0 flex overflow-hidden text-star transition-[width] duration-700 ease-out"
        style={{ width: shown ? `${(value / 5) * 100}%` : "0%" }}
      >
        {row}
      </span>
    </span>
  )
}

export function TextLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 text-ink underline-offset-4 hover:underline"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  )
}

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={className}>
      <div className="mx-auto w-full max-w-[1160px] px-5 sm:px-8">
        {children}
      </div>
    </section>
  )
}

export function SectionHead({
  title,
  line,
}: {
  title: ReactNode
  line?: ReactNode
}) {
  return (
    <div className="mx-auto max-w-[660px] text-center">
      <h2 className="font-display text-[clamp(30px,4.2vw,44px)] leading-[1.1] font-medium tracking-[-0.025em]">
        {title}
      </h2>
      {line && (
        <p className="mt-4 text-[17px] leading-relaxed text-muted">{line}</p>
      )}
    </div>
  )
}
