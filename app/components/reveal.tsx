"use client"

import { motion, useReducedMotion, type Variants } from "motion/react"
import type { ReactNode } from "react"

const EASE = [0.16, 1, 0.3, 1] as const
const VIEW = { once: true, amount: 0.15, margin: "0px 0px -6% 0px" } as const

// `custom` is a delay in seconds.
const rise: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  shown: (delay = 0) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: EASE, delay },
  }),
}
// For staggered items: no delay of their own, so the parent's stagger sets it.
const riseItem: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
}
const still: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.3 } },
}

// Fades its children up, out of a light blur, the first time they scroll into
// view.
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduce = !!useReducedMotion()
  return (
    <motion.div
      className={className}
      variants={reduce ? still : rise}
      initial="hidden"
      whileInView="shown"
      viewport={VIEW}
      custom={delay / 1000}
    >
      {children}
    </motion.div>
  )
}

// Reveals its StaggerItem children one after another.
export function Stagger({
  children,
  className = "",
  gap = 0.07,
  as = "div",
}: {
  children: ReactNode
  className?: string
  gap?: number
  as?: "div" | "ul" | "dl" | "ol"
}) {
  const Tag = motion[as]
  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={VIEW}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: gap } } }}
    >
      {children}
    </Tag>
  )
}

export function StaggerItem({
  children,
  className = "",
  as = "div",
}: {
  children: ReactNode
  className?: string
  as?: "div" | "li"
}) {
  const reduce = !!useReducedMotion()
  const Tag = motion[as]
  return (
    <Tag className={className} variants={reduce ? still : riseItem}>
      {children}
    </Tag>
  )
}
