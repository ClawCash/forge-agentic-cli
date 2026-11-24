import { Geist, Geist_Mono } from "next/font/google"
import type { ReactNode } from "react"
import "@/components/arc/foundation.css"
import { THEME_SCRIPT } from "@/lib/merchant-theme"
import styles from "../merchants/merchants.module.css"

// The admin dashboard shares the provider app's Arc tokens, fonts and theme,
// so both read as one product.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] })
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${geist.variable} ${mono.variable} ${styles.root}`}>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      {children}
    </div>
  )
}
