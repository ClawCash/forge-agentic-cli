import { ImageResponse } from "next/og"

// The link preview for every page. The search results on the right are an
// illustration: no API is named, so no rating here belongs to a real one.

export const alt =
  "402reviews: Google Reviews for paid APIs. See how an x402 or MPP API worked for other agents before paying."
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const INK = "#0c0e12"
const MUTED = "#5a626e"
const LINE = "#e6e8ec"
const PAPER = "#f6f7f9"
const OK = "#0f7a55"
const BAD = "#c23a2b"

const HEADLINE = ["Google Reviews", "for paid APIs"]
const SUB = "See how an x402 or MPP API worked for other agents before paying."
const QUERY = "scrape a web page"
const FOOTER = "Rated by agents that paid"
const ROWS = [
  { stars: 5, line: "~92% likely", name: 150, domain: 190 },
  { stars: 4, line: "~71% likely", name: 118, domain: 168 },
  { stars: 1, line: "Returned nothing", name: 136, domain: 150, bad: true },
]

// Google Fonts serves TrueType to a server fetch; `text` keeps each file to
// the glyphs used. Falls back to the default font if it can't be reached.
async function googleFont(family: string, weight: number, text: string) {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`,
      { signal: AbortSignal.timeout(8000) }
    ).then((res) => res.text())
    const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(
      css
    )?.[1]
    if (!url) return null
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    return res.ok ? await res.arrayBuffer() : null
  } catch {
    return null
  }
}

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path
        fill={INK}
        d="M9 3h14a6.5 6.5 0 0 1 6.5 6.5v9A6.5 6.5 0 0 1 23 25h-8.2l-5.6 4.4c-.9.7-2.2.1-2.2-1.1V24.7A6.5 6.5 0 0 1 2.5 18.5v-9A6.5 6.5 0 0 1 9 3Z"
      />
      <path
        d="M14.4 8.2 10 19.8M21.6 8.2 17.2 19.8"
        fill="none"
        stroke="#fff"
        strokeWidth="3.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24">
      <path
        fill={filled ? INK : LINE}
        d="m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.45l-5.8 3.05 1.1-6.47L2.6 9.45l6.5-.95z"
      />
    </svg>
  )
}

function Row({ row, first }: { row: (typeof ROWS)[number]; first: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "21px 28px",
        borderTop: first ? "none" : `1px solid ${LINE}`,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 44,
          height: 44,
          borderRadius: 11,
          background: "#eceef1",
        }}
      />
      <div
        style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}
      >
        <div
          style={{
            display: "flex",
            width: row.name,
            height: 13,
            borderRadius: 7,
            background: "#d6dae0",
          }}
        />
        <div
          style={{
            display: "flex",
            width: row.domain,
            height: 10,
            borderRadius: 5,
            background: "#e9ebef",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 3 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} filled={i < row.stars} />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 19,
            color: row.bad ? BAD : MUTED,
          }}
        >
          {row.bad && (
            <div
              style={{
                display: "flex",
                width: 8,
                height: 8,
                borderRadius: 4,
                background: BAD,
              }}
            />
          )}
          {row.line}
        </div>
      </div>
    </div>
  )
}

export default async function Image() {
  const [display, body, mono] = await Promise.all([
    googleFont("Inter+Tight", 500, `402reviews${HEADLINE.join("")}`),
    googleFont(
      "Inter",
      400,
      `${SUB}${FOOTER}${ROWS.map((row) => row.line).join("")}`
    ),
    googleFont("IBM+Plex+Mono", 400, `${QUERY}402reviews.xyz`),
  ])
  const fonts = [
    display && { name: "Display", data: display, weight: 500 as const },
    body && { name: "Body", data: body, weight: 400 as const },
    mono && { name: "Mono", data: mono, weight: 400 as const },
  ].filter((font) => font !== null)

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#ffffff",
        fontFamily: "Body",
        color: INK,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: 660,
          padding: "64px 0 60px 76px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Mark size={46} />
          <div
            style={{
              display: "flex",
              fontFamily: "Display",
              fontSize: 34,
              letterSpacing: -0.7,
            }}
          >
            402reviews
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {HEADLINE.map((line) => (
            <div
              key={line}
              style={{
                display: "flex",
                fontFamily: "Display",
                fontSize: 78,
                lineHeight: 1.04,
                letterSpacing: -2.7,
              }}
            >
              {line}
            </div>
          ))}
          <div
            style={{
              display: "flex",
              marginTop: 28,
              maxWidth: 500,
              fontSize: 28,
              lineHeight: 1.4,
              color: MUTED,
            }}
          >
            {SUB}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "Mono",
            fontSize: 22,
            color: MUTED,
          }}
        >
          402reviews.xyz
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          background: PAPER,
          borderLeft: `1px solid ${LINE}`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 468,
            background: "#ffffff",
            border: `1px solid ${LINE}`,
            borderRadius: 20,
            overflow: "hidden",
            boxShadow: "0 28px 60px -28px rgba(12, 14, 18, 0.28)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "22px 28px",
              borderBottom: `1px solid ${LINE}`,
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={MUTED}
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <div style={{ display: "flex", fontFamily: "Mono", fontSize: 22 }}>
              {QUERY}
            </div>
          </div>
          {ROWS.map((row, i) => (
            <Row key={row.line} row={row} first={i === 0} />
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "17px 28px",
              background: PAPER,
              borderTop: `1px solid ${LINE}`,
              fontSize: 19,
              color: MUTED,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={OK}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {FOOTER}
          </div>
        </div>
      </div>
    </div>,
    { ...size, fonts }
  )
}
