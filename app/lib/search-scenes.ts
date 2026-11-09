import { API_URL } from "@/lib/links"

export interface SceneResult {
  name: string
  logo?: string
  host: string
  price: string
  stars: number
  worked: number
}

export interface Scene {
  agent: string
  agentLogo: string
  query: string
  // In listing order, cheapest first. Reviews then reorder them.
  results: SceneResult[]
}

// Example reviews on made-up APIs, used only if the live ratings can't load.
// The .example hosts can't belong to anyone, so no real seller gets an invented
// rating.
const EXAMPLE_SCENES: Scene[] = [
  {
    agent: "Claude Code",
    agentLogo: "claudecode.svg",
    query: "scrape a webpage to markdown",
    results: [
      {
        name: "FastScrape",
        host: "fastscrape.example/markdown",
        price: "$0.001",
        stars: 1.4,
        worked: 18,
      },
      {
        name: "PagePull",
        host: "pagepull.example/v1/scrape",
        price: "$0.004",
        stars: 3,
        worked: 58,
      },
      {
        name: "CleanMark",
        host: "cleanmark.example/api/scrape",
        price: "$0.012",
        stars: 4.8,
        worked: 96,
      },
    ],
  },
  {
    agent: "Codex",
    agentLogo: "codex.svg",
    query: "find business leads and contact emails at a company",
    results: [
      {
        name: "LeadDump",
        host: "leaddump.example/search",
        price: "$0.02",
        stars: 1.7,
        worked: 24,
      },
      {
        name: "ReachBase",
        host: "reachbase.example/people",
        price: "$0.05",
        stars: 4.6,
        worked: 93,
      },
      {
        name: "ContactGrid",
        host: "contactgrid.example/find",
        price: "$0.08",
        stars: 3.2,
        worked: 62,
      },
    ],
  },
  {
    agent: "Cursor",
    agentLogo: "cursor.svg",
    query: "search the web for recent news",
    results: [
      {
        name: "QuickWire",
        host: "quickwire.example/news",
        price: "$0.003",
        stars: 2.1,
        worked: 35,
      },
      {
        name: "PressIndex",
        host: "pressindex.example/search",
        price: "$0.01",
        stars: 4.7,
        worked: 95,
      },
      {
        name: "Headliner",
        host: "headliner.example/v2/news",
        price: "$0.02",
        stars: 3.4,
        worked: 68,
      },
    ],
  },
  {
    agent: "Grok Bot",
    agentLogo: "grokbot.svg",
    query: "get recent posts from an X account",
    results: [
      {
        name: "PostScraper",
        host: "postscraper.example/timeline",
        price: "$0.0005",
        stars: 1.2,
        worked: 14,
      },
      {
        name: "FeedRelay",
        host: "feedrelay.example/user/posts",
        price: "$0.01",
        stars: 4.5,
        worked: 91,
      },
      {
        name: "SocialPipe",
        host: "socialpipe.example/x/posts",
        price: "$0.06",
        stars: 3.6,
        worked: 74,
      },
    ],
  },
  {
    agent: "Hermes",
    agentLogo: "hermesagent.svg",
    query: "get a live token price on Base",
    results: [
      {
        name: "QuoteCheap",
        host: "quotecheap.example/price",
        price: "$0.0002",
        stars: 1.8,
        worked: 29,
      },
      {
        name: "ChainTick",
        host: "chaintick.example/v1/price",
        price: "$0.002",
        stars: 4.9,
        worked: 98,
      },
      {
        name: "PriceMesh",
        host: "pricemesh.example/token",
        price: "$0.005",
        stars: 3.3,
        worked: 66,
      },
    ],
  },
]

interface Listing {
  name: string
  logo: string
  url: string
  price: string
}

// Real listings. Their stars always come from real reviews, read live, and a
// scene with an unreviewed listing isn't shown.
const REAL_SCENES: (Omit<Scene, "results"> & { results: Listing[] })[] = [
  {
    agent: "Claude Code",
    agentLogo: "claudecode.svg",
    query: "scrape a webpage to markdown",
    results: [
      {
        name: "WebberSites",
        logo: "webbersites.png",
        url: "https://api.webbersites.com/api/scrape",
        price: "$0.001",
      },
      {
        name: "StableEnrich",
        logo: "stableenrich.png",
        url: "https://stableenrich.dev/api/firecrawl/scrape",
        price: "$0.0126",
      },
    ],
  },
  {
    agent: "Cursor",
    agentLogo: "cursor.svg",
    query: "search the web for recent news",
    results: [
      {
        name: "Toolsmith",
        logo: "toolsmith.png",
        url: "https://toolcall.click/t/news/search",
        price: "$0.01",
      },
      {
        name: "StableEnrich",
        logo: "stableenrich.png",
        url: "https://stableenrich.dev/api/exa/search",
        price: "$0.01",
      },
    ],
  },
]

interface CheckResult {
  url: string
  stars: number | null
  works_for_task: number | null
}

async function liveRatings(urls: string[]) {
  try {
    const res = await fetch(`${API_URL}/v1/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return new Map<string, CheckResult>()
    const { results } = (await res.json()) as { results: CheckResult[] }
    return new Map(results.map((result) => [result.url, result]))
  } catch {
    return new Map<string, CheckResult>()
  }
}

export async function getScenes(): Promise<{
  scenes: Scene[]
  real: boolean
}> {
  const ratings = await liveRatings(
    REAL_SCENES.flatMap((scene) => scene.results.map((r) => r.url))
  )
  const scenes = REAL_SCENES.flatMap((scene) => {
    const results = scene.results.flatMap(({ url, ...listing }) => {
      const rating = ratings.get(url)
      if (rating?.stars == null || rating.works_for_task == null) return []
      return [
        {
          ...listing,
          host: url.replace("https://", ""),
          stars: rating.stars,
          worked: Math.round(rating.works_for_task * 100),
        },
      ]
    })
    return results.length === scene.results.length
      ? [{ ...scene, results }]
      : []
  })
  return scenes.length > 0
    ? { scenes, real: true }
    : { scenes: EXAMPLE_SCENES, real: false }
}
