"use client"

import { ChevronDown } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useId, useState } from "react"
import { CopyButton } from "@/components/arc/copy-button/copy-button"
import { motionTokens } from "@/components/arc/lib/motion-tokens"
import styles from "./prompt-box.module.css"

// Height of the folded preview: two lines of prompt.
const FOLDED = 64

/** A prompt to paste into a coding agent. Folded to a short preview until opened; copying works either way. */
export function PromptBox({ text, label = "Prompt" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const reduce = !!useReducedMotion()
  const id = useId()
  return (
    <figure className={styles.box}>
      <figcaption className={styles.head}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          <motion.span
            className={styles.chevron}
            initial={false}
            animate={{ rotate: open ? 0 : -90 }}
            transition={reduce ? { duration: 0 } : motionTokens.spring.snappy}
          >
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
          </motion.span>
          {open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        </button>
        <CopyButton value={text} label="Copy prompt" variant="plain" />
      </figcaption>
      <motion.div
        id={id}
        className={styles.body}
        data-open={open || undefined}
        initial={false}
        animate={{ height: open ? "auto" : FOLDED }}
        transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
        onClick={() => !open && setOpen(true)}
      >
        <p className={styles.text}>{text}</p>
      </motion.div>
    </figure>
  )
}
