import { randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"

// Scraping pages with codes no model can know. Each kind stresses something
// real scrapers differ on: plain pages, a code far down a long page, and Hindi.

const root = new URL("../../", import.meta.url).pathname
const SITE = "https://reviews.forgeintel.co/eval"

const filler = (n) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<p>Paragraph ${i + 1} of this reference document is here to give the page some length, in the way a long article would.</p>`
  ).join("\n")

const hindi =
  "<p>यह पृष्ठ एक परीक्षण दस्तावेज़ है। इसे हिंदी में लिखा गया है ताकि पाठ निकालने वाली सेवाओं की जाँच हो सके।</p>"

const BODIES = {
  plain: (code) =>
    `<h1>Service notice</h1>\n<p>This page has a verification code.</p>\n<p>Verification code: ${code}</p>`,
  long: (code) =>
    `<h1>Long reference document</h1>\n${filler(120)}\n<p>Verification code: ${code}</p>`,
  hindi: (code) =>
    `<h1>सेवा सूचना</h1>\n${hindi}\n<p>सत्यापन कोड: ${code}</p>\n${hindi}`,
}

const page = (body, lang) =>
  `<!doctype html>\n<html lang="${lang}">\n<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Reference page</title></head>\n<body>\n${body}\n</body>\n</html>\n`

mkdirSync(`${root}app/public/eval`, { recursive: true })
const fixtures = []
for (const phase of ["seed", "test"]) {
  for (const kind of Object.keys(BODIES)) {
    const id = `${phase}-${kind}`
    const slug = randomBytes(6).toString("hex")
    const code = `RVW-${randomBytes(4).toString("hex").toUpperCase()}`
    const lang = kind === "hindi" ? "hi" : "en"
    writeFileSync(
      `${root}app/public/eval/${slug}.html`,
      page(BODIES[kind](code), lang)
    )
    fixtures.push({
      id,
      phase,
      kind,
      code,
      url: `${SITE}/${slug}.html`,
      language: lang === "hi" ? "hi" : undefined,
    })
  }
}
writeFileSync(
  new URL("fixtures.json", import.meta.url),
  `${JSON.stringify(fixtures, null, 1)}\n`
)
console.log(fixtures.map((f) => `${f.id} ${f.url}`).join("\n"))
