import { API_URL } from "@/lib/links"

export interface SceneRating {
  stars: number | null
  worked: number | null
  buyers: number
}

export interface SceneResult {
  name: string
  logo: string
  url: string
  price: string
  // Missing only when the ratings could not be loaded.
  rating?: SceneRating
}

export interface Scene {
  agent: string
  agentLogo: string
  query: string
  results: SceneResult[]
}

// Real searches and real listings, taken from AgentCash search and
// StableEnrich's own endpoint list in November 2026. Ratings are always live.
const STABLE_ENRICH = { name: "StableEnrich", logo: "stableenrich.png" }
const ANYAPI = { name: "AnyAPI", logo: "anyapi.png" }

const SCENES: Scene[] = [
  {
    agent: "Claude Code",
    agentLogo: "claudecode.svg",
    query: "scrape a webpage to markdown",
    results: [
      {
        ...STABLE_ENRICH,
        url: "https://stableenrich.dev/api/firecrawl/scrape",
        price: "$0.0126",
      },
      {
        name: "WebberSites",
        logo: "webbersites.png",
        url: "https://api.webbersites.com/api/scrape",
        price: "$0.001",
      },
      {
        name: "JarvisClaw",
        logo: "jarvisclaw.png",
        url: "https://api.jarvisclaw.ai/v1/marketplace/api/markdown-scraper-2616",
        price: "$0.0115",
      },
    ],
  },
  {
    agent: "Codex",
    agentLogo: "codex.svg",
    query: "get a quote for an x402 payment",
    results: [
      {
        name: "X Pay",
        logo: "xpay.png",
        url: "https://www.api-xpay.com/x402/quote",
        price: "$0.005",
      },
      {
        name: "Agent402",
        logo: "agent402.png",
        url: "https://agent402.tools/api/x402-quote",
        price: "$0.002",
      },
      {
        name: "Apex Faucet",
        logo: "apexfaucet.svg",
        url: "https://apexfaucet.xyz/api/x402/echo",
        price: "$0.004",
      },
    ],
  },
  {
    agent: "Cursor",
    agentLogo: "cursor.svg",
    query: "find business leads and contact emails at a company",
    results: [
      {
        ...STABLE_ENRICH,
        url: "https://stableenrich.dev/api/fullenrich/people-search",
        price: "$0.15",
      },
      {
        name: "Deepline",
        logo: "deepline.svg",
        url: "https://stable-deepline.dev/api/email/work",
        price: "$0.04",
      },
      {
        ...ANYAPI,
        url: "https://api.getanyapi.com/v1/run/email_finding.dropleads",
        price: "$0.0312",
      },
    ],
  },
  {
    agent: "Grok Bot",
    agentLogo: "grokbot.svg",
    query: "search the web for recent news",
    results: [
      {
        ...STABLE_ENRICH,
        url: "https://stableenrich.dev/api/exa/search",
        price: "$0.01",
      },
      {
        name: "Toolsmith",
        logo: "toolsmith.png",
        url: "https://toolcall.click/t/news/search",
        price: "$0.01",
      },
      {
        name: "Toll402",
        logo: "toll402.svg",
        url: "https://toll402.dev/v1/p/tinyfish.web.search.news",
        price: "$0.001",
      },
    ],
  },
  {
    agent: "Hermes",
    agentLogo: "hermesagent.svg",
    query: "get recent posts from an X account",
    results: [
      {
        name: "StableSocial",
        logo: "stablesocial.svg",
        url: "https://socialx402.com/api/sc/twitter/user-tweets",
        price: "$0.06",
      },
      {
        name: "twit.sh",
        logo: "twitsh.png",
        url: "https://x402.twit.sh/communities/posts",
        price: "$0.01",
      },
      {
        ...ANYAPI,
        url: "https://api.getanyapi.com/v1/run/twitter.user_posts",
        price: "$0.00045",
      },
    ],
  },
]

interface CheckResult {
  url: string
  stars: number | null
  works_for_task: number | null
  buyers: number
}

export async function getScenes(): Promise<Scene[]> {
  const urls = SCENES.flatMap((scene) => scene.results.map((r) => r.url))
  const ratings = new Map<string, SceneRating>()
  try {
    const res = await fetch(`${API_URL}/v1/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const { results } = (await res.json()) as { results: CheckResult[] }
      for (const { url, stars, works_for_task, buyers } of results) {
        ratings.set(url, { stars, worked: works_for_task, buyers })
      }
    }
  } catch {
    // Without ratings the listings still show, with no rating claimed.
  }
  return SCENES.map((scene) => ({
    ...scene,
    results: scene.results.map((result) => ({
      ...result,
      rating: ratings.get(result.url),
    })),
  }))
}
