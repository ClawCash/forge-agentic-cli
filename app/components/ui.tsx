import { ArrowUpRight } from "lucide-react"
import type { ReactNode } from "react"

// The asterisk mark used for the brand.
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`text-accent ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
    </svg>
  )
}

export function Logo() {
  return (
    <a
      href="#top"
      className="flex items-center gap-2"
      aria-label="Agent Reviews home"
    >
      <Mark className="size-[18px]" />
      <span className="text-[19px] font-semibold tracking-[-0.04em]">
        Agent Reviews<span className="text-accent">.</span>
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
        className="absolute inset-y-0 left-0 flex overflow-hidden text-accent transition-[width] duration-[1000ms] ease-out"
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
      <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-6">
        {children}
      </div>
    </section>
  )
}
