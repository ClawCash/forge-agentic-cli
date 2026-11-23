import { Geist, Geist_Mono } from "next/font/google"
import type { ReactNode } from "react"
import "@/components/arc/foundation.css"
import { THEME_SCRIPT } from "@/lib/merchant-theme"
import styles from "./merchants.module.css"

// The merchant app is built on Arc. Its tokens and fonts load here only, so
// the public site keeps its own look.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] })
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export default function MerchantLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${geist.variable} ${mono.variable} ${styles.root}`}>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      {children}
    </div>
  )
}
