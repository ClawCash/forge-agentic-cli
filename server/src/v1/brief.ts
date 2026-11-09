import type { Rating } from "./rating.ts"

// What gets added to a wallet's search results: numbers and fixed words only.
// Reviews are written by strangers, so their text waits until an agent asks.

const DOMAIN = /^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/
export const MAX_BRIEF_DOMAINS = 50

export interface BriefEntry {
  domain: string
  rating: Rating
  down: boolean
}

export function briefDomains(input: unknown) {
  if (!Array.isArray(input)) return []
  const domains = input.flatMap((value) => {
    if (typeof value !== "string") return []
    const domain = value
      .trim()
      .toLowerCase()
      .replace(/^www\./, "")
    return DOMAIN.test(domain) ? [domain] : []
  })
  return [...new Set(domains)].slice(0, MAX_BRIEF_DOMAINS)
}

function briefLine({ domain, rating, down }: BriefEntry) {
  const notResponding = down ? "not responding when last checked" : null
  if (rating.stars === null) {
    return notResponding && `${domain}: ${notResponding}`
  }
  const accuracy = rating.listing_accuracy
  const compared = accuracy
    ? accuracy.accurate + accuracy.overstated + accuracy.misleading
    : 0
  const details = [
    `${rating.stars}/5 from ${rating.buyers} ${rating.buyers === 1 ? "agent" : "agents"}`,
    `about ${Math.round((rating.works_for_task ?? 0) * 100)}% likely to work`,
    rating.verdict !== "unknown" && `verdict ${rating.verdict}`,
    accuracy && `matched its listing ${accuracy.accurate} of ${compared}`,
    rating.top_problem &&
      `top problem ${rating.top_problem.replaceAll("_", " ")}`,
    notResponding,
  ]
  return `${domain}: ${details.filter(Boolean).join(", ")}`
}

export function brief(entries: BriefEntry[]) {
  const lines = entries.flatMap((entry) => briefLine(entry) ?? [])
  const reviewed = entries.filter((e) => e.rating.stars !== null).length
  const unreviewed = entries.length - reviewed
  if (lines.length === 0) {
    return {
      text: "Agent Reviews: none of these APIs have reviews yet.",
      reviewed,
      unreviewed,
    }
  }
  const text = [
    "Agent Reviews, from agents that paid for these APIs:",
    ...lines.map((line) => `- ${line}`),
    ...(unreviewed > 0
      ? [
          `No reviews yet for ${unreviewed} of ${entries.length} APIs in these results.`,
        ]
      : []),
    ...(reviewed > 0
      ? ["See what each one promised and delivered with get_api_reviews."]
      : []),
  ].join("\n")
  return { text, reviewed, unreviewed }
}
