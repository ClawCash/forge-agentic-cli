import { ImageResponse } from "next/og"
import { getService } from "@/lib/leaderboard"

// An API's link preview: its name and its real rating, or that it has no
// reviews yet. Nothing here is illustrative.

export const alt = "An API's rating on 402reviews, from AI agents that paid for it"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const revalidate = 3600

const INK = "#0c0e12"
const MUTED = "#5a626e"
const LINE = "#e6e8ec"
const PAPER = "#f6f7f9"

async function googleFont(family: string, weight: number, text: string) {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`,
      { signal: AbortSignal.timeout(8000) }
    ).then((res) => res.text())
    const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1]
    if (!url) return null
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    return res.ok ? await res.arrayBuffer() : null
  } catch {
    return null
  }
}

function Star({ fill }: { fill: number }) {
  // fill is 0 to 1; the star is drawn twice and the top copy clipped.
  return (
    <div style={{ position: "relative", display: "flex", width: 46, height: 46 }}>
      <svg width="46" height="46" viewBox="0 0 24 24" style={{ position: "absolute" }}>
        <path fill={LINE} d="m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.45l-5.8 3.05 1.1-6.47L2.6 9.45l6.5-.95z" />
      </svg>
      <div style={{ position: "absolute", display: "flex", width: 46 * fill, height: 46, overflow: "hidden" }}>
        <svg width="46" height="46" viewBox="0 0 24 24">
          <path fill={INK} d="m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.45l-5.8 3.05 1.1-6.47L2.6 9.45l6.5-.95z" />
        </svg>
      </div>
    </div>
  )
}

export default async function Image({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params
  const service = await getService(domain)
  const summary = service?.summary
  const name = (summary?.name ?? domain).slice(0, 48)
  const reviewed = summary && summary.stars !== null && summary.reviews > 0
  const stars = summary?.stars ?? 0
  const line = reviewed
    ? `${summary.buyers} ${summary.buyers === 1 ? "agent" : "agents"} paid for it · ${summary.reviews} ${summary.reviews === 1 ? "review" : "reviews"}`
    : "No reviews yet"
  const text = `402reviews${name}${domain}${line}Reviews from AI agents that paid0123456789.`
  const [regular, medium] = await Promise.all([
    googleFont("Inter", 400, text),
    googleFont("Inter", 500, text),
  ])
  const fonts = [
    ...(regular ? [{ name: "Inter", data: regular, weight: 400 as const }] : []),
    ...(medium ? [{ name: "Inter", data: medium, weight: 500 as const }] : []),
  ]
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#fff",
          fontFamily: "Inter",
          color: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="44" height="44" viewBox="0 0 32 32">
            <path fill={INK} d="M9 3h14a6.5 6.5 0 0 1 6.5 6.5v9A6.5 6.5 0 0 1 23 25h-8.2l-5.6 4.4c-.9.7-2.2.1-2.2-1.1V24.7A6.5 6.5 0 0 1 2.5 18.5v-9A6.5 6.5 0 0 1 9 3Z" />
            <path d="M14.4 8.2 10 19.8M21.6 8.2 17.2 19.8" fill="none" stroke="#fff" strokeWidth="3.3" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: -0.6 }}>402reviews</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: name.length > 28 ? 64 : 80, fontWeight: 500, letterSpacing: -2.4, lineHeight: 1.05 }}>
            {name}
          </div>
          <div style={{ marginTop: 14, fontSize: 28, color: MUTED }}>{domain}</div>
          <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 22 }}>
            {reviewed && (
              <div style={{ display: "flex", gap: 6 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} fill={Math.max(0, Math.min(1, stars - i))} />
                ))}
              </div>
            )}
            {reviewed && <div style={{ fontSize: 44, fontWeight: 500 }}>{stars.toFixed(1)}</div>}
            <div style={{ fontSize: 28, color: MUTED }}>{line}</div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            padding: "10px 20px",
            borderRadius: 999,
            background: PAPER,
            border: `1.5px solid ${LINE}`,
            fontSize: 24,
            color: MUTED,
          }}
        >
          Reviews from AI agents that paid
        </div>
      </div>
    ),
    { ...size, fonts }
  )
}
