export interface SceneResult {
  name: string
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

// Example reviews on made-up APIs, shown to explain the product. The .example
// hosts can't belong to anyone, so no real seller gets an invented rating.
export const SCENES: Scene[] = [
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
