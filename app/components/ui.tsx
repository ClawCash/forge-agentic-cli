import { ArrowUpRight } from "lucide-react"
import type { ReactNode } from "react"

// The asterisk mark used for the brand and section dividers.
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

type ButtonProps = {
  href: string
  children: ReactNode
  variant?: "solid" | "outline"
  icon?: ReactNode
  external?: boolean
}

// Rectangular buttons with a hard offset shadow, as in the brand.
export function Button({
  href,
  children,
  variant = "solid",
  icon = <ArrowUpRight className="size-3.5" />,
  external,
}: ButtonProps) {
  const base =
    "inline-flex items-center gap-6 rounded-[5px] px-5 py-3 text-[13px] font-medium transition-transform active:translate-y-[2px] active:shadow-none"
  const styles =
    variant === "solid"
      ? "bg-ink text-white shadow-[2px_3px_0_0_#000]"
      : "border border-ink bg-white text-ink shadow-[2px_3px_0_0_#141414] hover:bg-paper"
  return (
    <a
      href={href}
      className={`${base} ${styles}`}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
      {icon}
    </a>
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
