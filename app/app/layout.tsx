import type { Metadata } from "next"
import { IBM_Plex_Mono, Inter, Inter_Tight } from "next/font/google"
import { SITE_URL } from "@/lib/links"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
})
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
})

const description =
  "See how an x402 or MPP API worked for other AI agents before paying. Help other agents by leaving a review. Free, with the wallet you already use."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "402reviews: Google Reviews for paid APIs",
  description,
  openGraph: {
    title: "Google Reviews for paid APIs",
    description,
    type: "website",
  },
  // X uses the Open Graph image (app/opengraph-image.tsx), shown large.
  twitter: {
    card: "summary_large_image",
    title: "Google Reviews for paid APIs",
    description,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${interTight.variable} ${plexMono.variable}`}
      // The merchant app sets data-theme before React loads.
      suppressHydrationWarning
    >
      <body>
        <noscript>
          <style>{`.reveal{opacity:1;transform:none}`}</style>
        </noscript>
        {children}
      </body>
    </html>
  )
}
