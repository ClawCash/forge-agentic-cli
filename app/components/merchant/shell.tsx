"use client"

// App frame for the merchant app. Adapted from agentlift's shell (itself from
// Arc's sidebar-rail block): a rail that folds, a floating panel on mid
// widths and a sheet on phones. Rows are real links driven by the query.

import * as Dialog from "@radix-ui/react-dialog"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import {
  CircleDashed,
  ExternalLink,
  Globe,
  LogOut,
  type LucideIcon,
  Plus,
  X,
} from "lucide-react"
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  type Transition,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react"
import Link from "next/link"
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { Avatar } from "@/components/arc/avatar/avatar"
import { motionTokens } from "@/components/arc/lib/motion-tokens"
import {
  type Theme,
  ThemeSwitch,
} from "@/components/arc/theme-switch/theme-switch"
import { Tooltip } from "@/components/arc/tooltip/tooltip"
import { THEME_KEY } from "@/lib/merchant-theme"
import styles from "./shell.module.css"

const FULL = 240
const RAIL = 64
const COMPACT = 480
const FLOAT = 640
const ROOMY = 760
const SETTLE_MS = 200

export type NavEntry = {
  id: string
  label: string
  href: string
  kind: "verified" | "pending" | "add" | "external"
  note?: string
}

const ICONS: Record<NavEntry["kind"], LucideIcon> = {
  verified: Globe,
  pending: CircleDashed,
  add: Plus,
  external: ExternalLink,
}

const curve = (points: readonly number[]) =>
  [...points] as [number, number, number, number]
const instant: Transition = { duration: 0 }

function labelTiming(collapsed: boolean, reduce: boolean): Transition {
  if (reduce) return instant
  return collapsed
    ? {
        duration: motionTokens.duration.fast,
        ease: curve(motionTokens.ease.standard),
      }
    : {
        duration: motionTokens.duration.standard,
        delay: 0.1,
        ease: curve(motionTokens.ease.enter),
      }
}

function RailTip({
  enabled,
  label,
  note,
  children,
}: {
  enabled: boolean
  label: string
  note?: string
  children: ReactElement
}) {
  const [open, setOpen] = useState(false)
  if (!enabled && open) setOpen(false)
  return (
    <TooltipPrimitive.Root
      open={enabled && open}
      onOpenChange={(next) => setOpen(next && enabled)}
    >
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className={styles.tip}
          side="right"
          sideOffset={14}
          collisionPadding={8}
        >
          {label}
          {note && <span className={styles.tipNote}>{note}</span>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

function NavRow({
  entry,
  current,
  collapsed,
  tips,
  reduce,
  onNavigate,
}: {
  entry: NavEntry
  current: boolean
  collapsed: boolean
  tips: boolean
  reduce: boolean
  onNavigate: () => void
}) {
  const Icon = ICONS[entry.kind]
  const fade = labelTiming(collapsed, reduce)
  const external = entry.kind === "external"
  const row = (
    <>
      {current && (
        <motion.span
          layoutId="merchant-nav-highlight"
          className={styles.highlight}
          style={{ borderRadius: 8 }}
          transition={reduce ? instant : motionTokens.spring.morph}
        />
      )}
      <Icon
        className={styles.icon}
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <motion.span
        className={`${styles.label} ${entry.kind === "verified" || entry.kind === "pending" ? styles.mono : ""}`}
        initial={false}
        animate={{ opacity: collapsed ? 0 : 1, x: collapsed ? -6 : 0 }}
        transition={fade}
      >
        {entry.label}
      </motion.span>
      {entry.note && (
        <motion.span
          className={styles.count}
          initial={false}
          animate={{ opacity: collapsed ? 0 : 1 }}
          transition={fade}
        >
          {entry.note}
        </motion.span>
      )}
    </>
  )
  const className = [styles.item, current ? styles.lit : ""].join(" ")
  return (
    <RailTip enabled={tips} label={entry.label} note={entry.note}>
      {external ? (
        <a
          href={entry.href}
          target="_blank"
          rel="noreferrer"
          className={className}
        >
          {row}
        </a>
      ) : (
        <Link
          href={entry.href}
          className={className}
          aria-current={current ? "page" : undefined}
          onClick={onNavigate}
        >
          {row}
        </Link>
      )}
    </RailTip>
  )
}

export type NavSection = { id: string; heading?: string; items: NavEntry[] }

function Navigation({
  variant,
  baseId,
  sections,
  footer,
  collapsed,
  active,
  reduce,
  onNavigate,
}: {
  variant: "side" | "sheet"
  baseId: string
  sections: NavSection[]
  footer: NavEntry[]
  collapsed: boolean
  active: string
  reduce: boolean
  onNavigate: () => void
}) {
  const tips = variant === "side" && collapsed
  const fade = labelTiming(collapsed, reduce)
  const height = reduce ? instant : motionTokens.spring.smooth
  const shared = { collapsed, tips, reduce, onNavigate }
  return (
    <motion.nav className={styles.nav} aria-label="Your APIs" layoutScroll>
      {sections.map((section) => {
        const headingId = `${baseId}-${variant}-${section.id}`
        return (
          <div
            key={section.id}
            className={styles.section}
            role={section.heading ? "group" : undefined}
            aria-labelledby={section.heading ? headingId : undefined}
          >
            {section.heading && (
              <motion.div
                className={styles.heading}
                initial={false}
                animate={{ height: collapsed ? 17 : 32 }}
                transition={height}
              >
                <motion.span
                  id={headingId}
                  className={styles.headingText}
                  initial={false}
                  animate={{ opacity: collapsed ? 0 : 1, x: collapsed ? -6 : 0 }}
                  transition={fade}
                >
                  {section.heading}
                </motion.span>
                <motion.span
                  className={styles.divider}
                  aria-hidden="true"
                  initial={false}
                  animate={{
                    opacity: collapsed ? 1 : 0,
                    scaleX: collapsed ? 1 : 0.3,
                  }}
                  transition={fade}
                />
              </motion.div>
            )}
            <ul className={styles.list} role="list">
              {section.items.map((entry) => (
                <li key={entry.id}>
                  <NavRow
                    entry={entry}
                    current={active === entry.id}
                    {...shared}
                  />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      <ul className={`${styles.list} ${styles.footerList}`} role="list">
        {footer.map((entry) => (
          <li key={entry.id}>
            <NavRow entry={entry} current={active === entry.id} {...shared} />
          </li>
        ))}
      </ul>
    </motion.nav>
  )
}

/** The 402reviews mark: a speech bubble with two slashes. */
export function ReviewsMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 3h14a6.5 6.5 0 0 1 6.5 6.5v9A6.5 6.5 0 0 1 23 25h-8.2l-5.6 4.4c-.9.7-2.2.1-2.2-1.1V24.7A6.5 6.5 0 0 1 2.5 18.5v-9A6.5 6.5 0 0 1 9 3Z"
      />
      <path
        d="M14.4 8.2 10 19.8M21.6 8.2 17.2 19.8"
        fill="none"
        stroke="var(--background)"
        strokeWidth="3.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Brand({ collapsed, reduce }: { collapsed: boolean; reduce: boolean }) {
  return (
    <Link href="?" className={styles.brand}>
      <span className={styles.brandMark} aria-hidden="true">
        <ReviewsMark />
      </span>
      <motion.span
        className={styles.stack}
        initial={false}
        animate={{ opacity: collapsed ? 0 : 1, x: collapsed ? -6 : 0 }}
        transition={labelTiming(collapsed, reduce)}
      >
        <strong>402reviews</strong>
        <span>For API providers</span>
      </motion.span>
    </Link>
  )
}

function Profile({
  email,
  collapsed,
  reduce,
}: {
  email: string
  collapsed: boolean
  reduce: boolean
}) {
  return (
    <div className={styles.profile}>
      <Avatar name={email} size="sm" />
      <motion.span
        className={styles.stack}
        initial={false}
        animate={{ opacity: collapsed ? 0 : 1, x: collapsed ? -6 : 0 }}
        transition={labelTiming(collapsed, reduce)}
      >
        <strong>{email}</strong>
        <span>Signed in</span>
      </motion.span>
      <motion.form
        action="/merchants/logout"
        method="post"
        className={styles.signOut}
        initial={false}
        animate={{ opacity: collapsed ? 0 : 1 }}
        transition={labelTiming(collapsed, reduce)}
      >
        <Tooltip content="Sign out" side="top">
          <button
            type="submit"
            className={styles.iconButton}
            aria-label="Sign out"
            tabIndex={collapsed ? -1 : undefined}
          >
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </Tooltip>
      </motion.form>
    </div>
  )
}

function PanelGlyph({
  collapsed,
  reduce,
}: {
  collapsed: boolean
  reduce: boolean
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="3.5" />
      <motion.path
        d="M8.25 4.25v11.5"
        initial={false}
        animate={{ x: collapsed ? -2.5 : 0 }}
        transition={reduce ? instant : motionTokens.spring.smooth}
      />
    </svg>
  )
}

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("light")
  useEffect(() => {
    setTheme(
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light"
    )
  }, [])
  function apply(next: Theme) {
    setTheme(next)
    document.documentElement.setAttribute("data-theme", next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {}
  }
  return [theme, apply]
}

export function MerchantShell({
  email,
  sections,
  footer,
  active,
  crumb,
  children,
}: {
  email: string
  sections: NavSection[]
  footer: NavEntry[]
  active: string
  crumb: string
  children: ReactNode
}) {
  const baseId = useId()
  const prefersReduced = !!useReducedMotion()
  const [settling, setSettling] = useState(true)
  const reduce = prefersReduced || settling
  const [collapsed, setCollapsed] = useState(false)
  const [floating, setFloating] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [frame, setFrame] = useState<HTMLElement | null>(null)
  const [status, setStatus] = useState("")
  const [theme, setTheme] = useTheme()
  const sheet = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const dragging = useRef(false)
  const closeTimer = useRef(0)
  const sidebarId = `${baseId}-sidebar`

  useEffect(() => {
    if (!frame) return
    function onKey(event: KeyboardEvent) {
      if (
        event.key !== "[" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        !frame
      )
        return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return
      event.preventDefault()
      if (frame.clientWidth < COMPACT) {
        setSheetOpen(!sheetOpen)
        return
      }
      setCollapsed(!collapsed)
      setStatus(collapsed ? "Sidebar expanded" : "Sidebar collapsed")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [frame, collapsed, sheetOpen])

  const roomy = useRef<boolean | null>(null)
  useLayoutEffect(() => {
    if (!frame) return
    const fit = () => {
      const width = frame.clientWidth
      if (width >= COMPACT) setSheetOpen(false)
      const floats = width >= COMPACT && width < FLOAT
      setFloating(floats)
      const next = width >= ROOMY
      if (roomy.current !== next) {
        roomy.current = next
        setCollapsed(!next)
      } else if (floats) setCollapsed(true)
    }
    fit()
    const settle = requestAnimationFrame(() => setSettling(false))
    const observer = new ResizeObserver(fit)
    observer.observe(frame)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(settle)
    }
  }, [frame])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const overlaid = floating && !collapsed

  function fold() {
    setCollapsed(true)
    setStatus("Sidebar collapsed")
  }

  function afterNavigate(fromSheet: boolean) {
    if (fromSheet && dragging.current) return
    if (!fromSheet && !overlaid) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(
      () => (fromSheet ? setSheetOpen(false) : setCollapsed(true)),
      reduce ? 0 : SETTLE_MS
    )
  }

  const sheetX = useMotionValue<number | string>("-100%")
  const scrimOpacity = useTransform(sheetX, (value) => {
    const width = sheet.current?.offsetWidth || 288
    const shift =
      typeof value === "number"
        ? value / width
        : value.endsWith("%")
          ? parseFloat(value) / 100
          : parseFloat(value) / width
    return Math.min(
      1,
      Math.max(0, 1 + (Number.isFinite(shift) ? shift : -1))
    )
  })

  const navProps = { baseId, sections, footer, active }

  return (
    <LayoutGroup id={baseId}>
      <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={300}>
        <section
          ref={setFrame}
          className={styles.shell}
          aria-label="402reviews for API providers"
          onKeyDown={(event) => {
            if (event.key === "Escape" && overlaid && !event.defaultPrevented) {
              event.preventDefault()
              fold()
            }
          }}
        >
          <motion.div
            className={styles.slot}
            initial={false}
            animate={{ width: floating || collapsed ? RAIL : FULL }}
            transition={reduce ? instant : motionTokens.spring.smooth}
          >
            <motion.div
              id={sidebarId}
              className={styles.sidebar}
              initial={false}
              animate={{ width: collapsed ? RAIL : FULL }}
              transition={reduce ? instant : motionTokens.spring.smooth}
              data-collapsed={collapsed || undefined}
              data-floating={overlaid || undefined}
            >
              <Brand collapsed={collapsed} reduce={reduce} />
              <Navigation
                variant="side"
                {...navProps}
                collapsed={collapsed}
                reduce={reduce}
                onNavigate={() => afterNavigate(false)}
              />
              <Profile email={email} collapsed={collapsed} reduce={reduce} />
            </motion.div>
          </motion.div>
          <AnimatePresence>
            {overlaid && (
              <motion.div
                key="float-scrim"
                className={`${styles.scrim} ${styles.floatScrim}`}
                aria-hidden="true"
                onClick={fold}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={
                  reduce
                    ? instant
                    : {
                        duration: motionTokens.duration.standard,
                        ease: curve(motionTokens.ease.standard),
                      }
                }
              />
            )}
          </AnimatePresence>

          <div className={styles.main}>
            <header className={styles.topbar}>
              <Tooltip
                side="bottom"
                content={
                  <span className={styles.shortcut}>
                    {collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    <kbd>[</kbd>
                  </span>
                }
              >
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.railToggle}`}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-expanded={!collapsed}
                  aria-controls={sidebarId}
                  aria-keyshortcuts="["
                  onClick={() => {
                    setCollapsed(!collapsed)
                    setStatus(
                      collapsed ? "Sidebar expanded" : "Sidebar collapsed"
                    )
                  }}
                >
                  <PanelGlyph collapsed={collapsed} reduce={reduce} />
                </button>
              </Tooltip>
              <button
                ref={menuButton}
                type="button"
                className={`${styles.iconButton} ${styles.menuButton}`}
                aria-label="Open navigation"
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                onClick={() => setSheetOpen(true)}
              >
                <PanelGlyph collapsed={false} reduce={reduce} />
              </button>
              <nav className={styles.crumbs} aria-label="Breadcrumb">
                <ol>
                  <li className={styles.crumbRoot}>
                    <span className={styles.siteName}>Your APIs</span>
                  </li>
                  <li className={styles.crumbCurrent} aria-current="page">
                    <span>{crumb}</span>
                  </li>
                </ol>
              </nav>
              <div className={styles.topbarEnd}>
                <ThemeSwitch
                  theme={theme}
                  onThemeChange={(next) => setTheme(next)}
                  iconOnly
                />
              </div>
            </header>

            <div className={styles.content}>{children}</div>
            <p className={styles.srOnly} role="status" aria-live="polite">
              {status}
            </p>
          </div>

          <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
            <AnimatePresence>
              {sheetOpen && frame && (
                <Dialog.Portal forceMount container={frame}>
                  <Dialog.Overlay asChild forceMount>
                    <motion.div
                      className={styles.scrim}
                      style={{ opacity: scrimOpacity }}
                    />
                  </Dialog.Overlay>
                  <Dialog.Content
                    asChild
                    forceMount
                    aria-describedby={undefined}
                    onCloseAutoFocus={(event) => {
                      event.preventDefault()
                      menuButton.current?.focus({ preventScroll: true })
                    }}
                  >
                    <motion.div
                      ref={sheet}
                      className={styles.sheet}
                      style={{ x: sheetX }}
                      initial={{ x: "-100%" }}
                      animate={{ x: 0 }}
                      exit={{ x: "-100%" }}
                      transition={reduce ? instant : motionTokens.spring.smooth}
                      drag={prefersReduced ? false : "x"}
                      dragConstraints={{ left: 0, right: 0 }}
                      dragElastic={{ left: 0.9, right: 0.04 }}
                      dragMomentum={false}
                      onDragStart={() => {
                        dragging.current = true
                        sheet.current?.setAttribute("data-dragging", "")
                      }}
                      onDragEnd={(_, info) => {
                        sheet.current?.removeAttribute("data-dragging")
                        window.setTimeout(() => {
                          dragging.current = false
                        }, 0)
                        if (info.offset.x < -72 || info.velocity.x < -480)
                          setSheetOpen(false)
                      }}
                    >
                      <Dialog.Title className={styles.srOnly}>
                        Navigation
                      </Dialog.Title>
                      <div className={styles.sheetHead}>
                        <Brand collapsed={false} reduce={reduce} />
                        <Dialog.Close asChild>
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label="Close navigation"
                          >
                            <X size={18} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        </Dialog.Close>
                      </div>
                      <Navigation
                        variant="sheet"
                        {...navProps}
                        collapsed={false}
                        reduce={reduce}
                        onNavigate={() => afterNavigate(true)}
                      />
                      <Profile email={email} collapsed={false} reduce={reduce} />
                    </motion.div>
                  </Dialog.Content>
                </Dialog.Portal>
              )}
            </AnimatePresence>
          </Dialog.Root>
        </section>
      </TooltipPrimitive.Provider>
    </LayoutGroup>
  )
}
