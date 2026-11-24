"use client"

import { motion, useReducedMotion } from "motion/react"
import Link from "next/link"
import { motionTokens } from "@/components/arc/lib/motion-tokens"
import styles from "./page-tabs.module.css"

export type PageTab = { id: string; label: string; href: string }

/** Sections of one page, as real links under its title. The underline glides to the section you open. */
export function PageTabs({ items, active, label }: { items: PageTab[]; active: string; label: string }) {
  const reduce = !!useReducedMotion()
  return (
    <nav className={styles.tabs} aria-label={label}>
      {items.map((item) => {
        const current = item.id === active
        return (
          <Link
            key={item.id}
            href={item.href}
            className={styles.tab}
            aria-current={current ? "page" : undefined}
            scroll={false}
          >
            {item.label}
            {current && (
              <motion.span
                layoutId="page-tab-underline"
                className={styles.underline}
                transition={reduce ? { duration: 0 } : motionTokens.spring.morph}
              />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
