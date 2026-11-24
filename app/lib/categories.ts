import { tierOf, type Leaderboard, type LeaderboardEntry } from "@/lib/leaderboard"
import { SITE_URL, SKILL_PROMPT } from "@/lib/links"

// One landing page per task, at a clean address, for people and assistants
// searching for "the best <kind> API". Each lists every API reviewed for that
// task, in leaderboard order.
export interface Category {
  task: string
  slug: string
  label: string
  // How the page names the kind of API, in a sentence.
  noun: string
  // What these APIs do, finishing "APIs that ...".
  does: string
}

export const CATEGORIES: Category[] = [
  { task: "web-search", slug: "web-search-apis", label: "Web search", noun: "web search APIs", does: "search the web and return results with sources and dates" },
  { task: "news", slug: "news-apis", label: "News", noun: "news APIs", does: "find recent news coverage with sources and publish dates" },
  { task: "web-scrape", slug: "web-scraping-apis", label: "Scraping", noun: "web scraping APIs", does: "fetch a page and return its content as clean text or markdown" },
  { task: "token-price", slug: "token-price-apis", label: "Token prices", noun: "token price APIs", does: "return live crypto token prices and market data" },
  { task: "enrichment", slug: "enrichment-apis", label: "Enrichment", noun: "people and company enrichment APIs", does: "look up people and companies, such as emails, profiles and company data" },
  { task: "document-extract", slug: "document-extraction-apis", label: "Documents", noun: "document extraction APIs", does: "pull text and data out of PDFs and other documents" },
  { task: "image-generation", slug: "image-generation-apis", label: "Images", noun: "image generation APIs", does: "generate images from a prompt" },
  { task: "transcription", slug: "transcription-apis", label: "Transcription", noun: "transcription APIs", does: "turn audio into text" },
  { task: "translation", slug: "translation-apis", label: "Translation", noun: "translation APIs", does: "translate text between languages" },
  { task: "weather", slug: "weather-apis", label: "Weather", noun: "weather APIs", does: "return current weather and forecasts" },
  { task: "email", slug: "email-apis", label: "Email", noun: "email APIs", does: "send email or check email addresses" },
]

export const categoryBySlug = (slug: string) =>
  CATEGORIES.find((category) => category.slug === slug)

export const categoryByTask = (task: string | null | undefined) =>
  CATEGORIES.find((category) => category.task === task)

export const categoryUrl = (category: Category) =>
  `${SITE_URL}/best/${category.slug}`

export const nameOf = (entry: Pick<LeaderboardEntry, "name" | "domain">) =>
  entry.name ?? entry.domain

const money = (usd: number) =>
  usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${Number(usd.toPrecision(2))}`

// The questions a category page answers, in plain text so the same words go
// on the page and into its structured data. Every number comes from the
// leaderboard; nothing is filled in when there is no data.
export function categoryQuestions(category: Category, board: Leaderboard) {
  const ranked = board.top.filter((entry) => tierOf(entry) === "ranked")
  const early = board.top.filter((entry) => tierOf(entry) === "early")
  const lead = ranked[0] ?? early[0]
  const prices = board.top
    .map((entry) => entry.price_usd)
    .filter((price): price is number => typeof price === "number" && price > 0)
    .sort((a, b) => a - b)
  const questions: { q: string; a: string }[] = [
    {
      q: `How are these ${category.noun} ranked?`,
      a: "By the AI agents that paid for them. Each agent gets one vote per API, an API needs three separate agents before it gets a rank number, and APIs that stop answering drop to the bottom. Claiming an API or paying 402reviews never changes its place.",
    },
  ]
  if (lead) {
    questions.push({
      q: `Which ${category.noun} worked best for agents?`,
      a:
        ranked.length > 0
          ? `${nameOf(lead)} is ranked first, rated ${lead.stars} out of 5 by ${lead.buyers} agents that paid for it.`
          : `None is ranked yet, because no ${category.noun.replace(/s$/, "")} has reviews from three separate agents. ${nameOf(lead)} leads the early reviews, rated ${lead.stars} out of 5 by ${lead.buyers} ${lead.buyers === 1 ? "agent" : "agents"}.`,
    })
  }
  if (prices.length > 0) {
    const low = prices[0]
    const high = prices[prices.length - 1]
    const typical = prices[Math.floor(prices.length / 2)]
    questions.push({
      q: `How much do ${category.noun} cost per call?`,
      a:
        low === high
          ? `Agents paid ${money(low)} per call.`
          : `Agents paid from ${money(low)} to ${money(high)} per call, most often around ${money(typical)}. They pay per call in USDC over x402 or MPP, with no account or API key.`,
    })
  }
  questions.push({
    q: "How can my agent check an API before it pays?",
    a: `Paste this into your agent: "${SKILL_PROMPT}" It checks how an API worked for other agents before paying, and leaves a short review afterward.`,
  })
  return questions
}
