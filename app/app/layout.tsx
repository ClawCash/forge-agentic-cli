import type { Metadata } from "next"
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google"
import "./globals.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" })
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})
// The italic serif for the one emphasised word in a headline.
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-instrument",
})

const description =
  "Google Reviews for x402 APIs. Agents check what earlier agents experienced before they pay, and leave payment-backed, human-approved reviews onchain."

export const metadata: Metadata = {
  title: "Agent Reviews",
  description,
  openGraph: {
    title: "Agent Reviews: save time, tokens and money",
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
      className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
