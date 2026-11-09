import { readFileSync } from "node:fs"

// The pilot's market: real x402 sellers, and tasks whose answers can be checked
// automatically and can't be answered from memory.

const here = new URL(".", import.meta.url).pathname
export const LISTINGS = JSON.parse(readFileSync(`${here}listings.json`, "utf8"))
export const FIXTURES = JSON.parse(readFileSync(`${here}fixtures.json`, "utf8"))

const query = (url, params) => `${url}?${new URLSearchParams(params)}`
const get = (url, params) => ({ url: query(url, params), method: "GET" })
const post = (url, body) => ({
  url,
  method: "POST",
  body: JSON.stringify(body),
})

// How each seller wants to be asked, taken from its own Bazaar listing.
const REQUESTS = {
  "token-price": [
    (u, c) => get(u, { coins: c.symbol }),
    (u, c) => get(u, { ids: c.id, vs_currencies: "usd" }),
    (u, c) => get(u, { token: c.symbol }),
    (u, c) => post(u, { symbol: c.symbol }),
    (u, c) => get(u, { token: c.symbol }),
  ],
  weather: [
    (u, c) => get(u, { city: c.city }),
    (u, c) => get(u, { city: c.city }),
    (u, c) => get(u, { place: c.city, days: 1 }),
    (u, c) => post(u, { location: c.city }),
    (u, c) => post(u, { city: c.city }),
  ],
  "web-scrape": [
    (u, c) => get(u, { url: c.url }),
    (u, c) => get(u, { url: c.url }),
    (u, c) => post(u, { url: c.url, max_chars: 50000 }),
    (u, c) => get(u, { url: c.url }),
    (u, c) => get(u, { url: c.url }),
  ],
}

export const sellersFor = (category) =>
  LISTINGS[category].map((listing, index) => ({
    ...listing,
    request: (input) => REQUESTS[category][index](listing.url, input),
  }))

const coin = (symbol, id) => ({ symbol, id })
const city = (name, lat, lon) => ({ city: name, lat, lon })

function priceTask(phase, n, input) {
  return {
    id: `token-${input.symbol.toLowerCase()}`,
    category: "token-price",
    phase,
    n,
    input,
    question: `What is the current price of ${input.symbol} in US dollars? Answer with the number.`,
  }
}

function weatherTask(phase, n, input) {
  return {
    id: `weather-${input.city.toLowerCase()}`,
    category: "weather",
    phase,
    n,
    input,
    question: `What is the current temperature in ${input.city} in degrees Celsius? Answer with the number.`,
  }
}

function scrapeTask(phase, n, page) {
  return {
    id: `scrape-${page.id}`,
    category: "web-scrape",
    phase,
    n,
    input: page,
    language: page.language,
    question: `Find the verification code on this page: ${page.url} Answer with the code.`,
  }
}

const pages = (phase) => FIXTURES.filter((page) => page.phase === phase)

export const TASKS = [
  ...[
    coin("ETH", "ethereum"),
    coin("SOL", "solana"),
    coin("DOGE", "dogecoin"),
  ].map((c, n) => priceTask("seed", n, c)),
  ...[
    coin("BTC", "bitcoin"),
    coin("LINK", "chainlink"),
    coin("AVAX", "avalanche-2"),
  ].map((c, n) => priceTask("test", n, c)),
  ...[
    city("London", 51.51, -0.13),
    city("Tokyo", 35.68, 139.69),
    city("Mumbai", 19.08, 72.88),
  ].map((c, n) => weatherTask("seed", n, c)),
  ...[
    city("Berlin", 52.52, 13.41),
    city("Sydney", -33.87, 151.21),
    city("Toronto", 43.65, -79.38),
  ].map((c, n) => weatherTask("test", n, c)),
  ...pages("seed").map((p, n) => scrapeTask("seed", n, p)),
  ...pages("test").map((p, n) => scrapeTask("test", n, p)),
]

// The right answer, read from a free source at the moment of capture.
export async function referenceFor(task, fetcher = fetch) {
  if (task.category === "token-price") {
    const res = await fetcher(
      `https://api.coingecko.com/api/v3/simple/price?ids=${task.input.id}&vs_currencies=usd`
    )
    return (await res.json())[task.input.id].usd
  }
  if (task.category === "weather") {
    const { lat, lon } = task.input
    const res = await fetcher(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m`
    )
    return (await res.json()).current.temperature_2m
  }
  return task.input.code
}

const numbers = (text) =>
  (String(text).match(/-?\d[\d,]*\.?\d*/g) ?? [])
    .map((value) => Number(value.replaceAll(",", "")))
    .filter((value) => Number.isFinite(value))

// Temperature fields only, when the text is JSON, so that humidity or a
// timestamp can't pass for the answer.
function temperatures(text) {
  try {
    const found = []
    const walk = (value, key = "") => {
      if (
        typeof value === "number" &&
        /temp/i.test(key) &&
        !/_?f$/i.test(key)
      ) {
        found.push(value)
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) walk(v, k)
      }
    }
    walk(JSON.parse(text))
    return found
  } catch {
    return numbers(text)
  }
}

export function passes(task, text, reference) {
  if (task.category === "token-price") {
    return numbers(text).some(
      (n) => Math.abs(n - reference) <= reference * 0.03
    )
  }
  if (task.category === "weather") {
    return temperatures(text).some((n) => Math.abs(n - reference) <= 3)
  }
  return String(text).includes(reference)
}
