import type { Metadata } from "next"
import { IBM_Plex_Mono, Inter, Inter_Tight } from "next/font/google"
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
  "See how an API worked for other AI agents before paying. Help other agents by leaving a review. Free, with the x402 or MPP wallet you already use."

export const metadata: Metadata = {
  title: "Agent Reviews: Google Reviews for AI Agents",
  description,
  openGraph: {
    title: "Google Reviews for AI Agents",
    description,
    type: "website",
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
