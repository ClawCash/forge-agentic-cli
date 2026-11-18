import type { Metadata } from "next"
import type { ReactNode } from "react"
import { CopyPrompt } from "@/components/copy-prompt"
import { SiteShell } from "@/components/site-shell"
import { type Block, DOC_SECTIONS, DOCS_URL, docsMarkdown } from "@/lib/docs"
import { SKILL_PROMPT } from "@/lib/links"

export const metadata: Metadata = {
  title: "Docs: 402reviews",
  description:
    "How 402reviews works: setup, ratings in your wallet's search, how reviews are verified and rated, and the MCP server, API and npm package.",
  alternates: { canonical: DOCS_URL },
}

// `code`, **bold** and [links](https://...) inside a line of text.
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const [, code, bold, label, href] = match
    if (code) {
      parts.push(
        <code
          key={at}
          className="rounded-[5px] bg-paper px-1.5 py-0.5 font-mono text-[0.86em] text-ink"
        >
          {code}
        </code>
      )
    } else if (bold) {
      parts.push(
        <strong key={at} className="font-medium text-ink">
          {bold}
        </strong>
      )
    } else {
      parts.push(
        <a
          key={at}
          href={href}
          {...(href.startsWith("http") && {
            target: "_blank",
            rel: "noreferrer",
          })}
          className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
        >
          {label}
        </a>
      )
    }
    last = at + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function Content({ block }: { block: Block }) {
  if ("text" in block) {
    return (
      <p className="text-[15px] leading-relaxed text-muted">
        <Inline text={block.text} />
      </p>
    )
  }
  if ("code" in block) {
    if (block.code === SKILL_PROMPT) return <CopyPrompt />
    return (
      <pre className="overflow-x-auto rounded-[12px] border border-line bg-paper p-4 font-mono text-[12.5px] leading-relaxed sm:p-5">
        {block.code}
      </pre>
    )
  }
  if ("list" in block || "steps" in block) {
    const items = "list" in block ? block.list : block.steps
    const List = "list" in block ? "ul" : "ol"
    return (
      <List className="space-y-2.5">
        {items.map((item, i) => (
          <li
            key={item}
            className="grid grid-cols-[22px_1fr] text-[15px] leading-relaxed text-muted"
          >
            <span className="font-mono text-[12px] leading-[1.7] text-faint">
              {"list" in block ? "–" : `${i + 1}.`}
            </span>
            <span>
              <Inline text={item} />
            </span>
          </li>
        ))}
      </List>
    )
  }
  const { head, rows } = block.table
  return (
    <div className="overflow-x-auto rounded-[12px] border border-line">
      <table className="w-full text-left text-[14px]">
        <thead className="bg-paper">
          <tr>
            {head.map((cell) => (
              <th key={cell} className="px-4 py-2.5 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-line align-top">
              {row.map((cell, i) => (
                <td
                  key={cell}
                  className={`px-4 py-2.5 leading-relaxed ${i === 0 ? "whitespace-nowrap" : "text-muted"}`}
                >
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Docs() {
  return (
    <SiteShell markdown={docsMarkdown()}>
      <main className="mx-auto grid w-full max-w-[1160px] gap-10 px-5 pt-14 pb-24 sm:px-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-24">
            <div className="label">Docs</div>
            <ul className="mt-4 space-y-2.5">
              {DOC_SECTIONS.map(({ id, title }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="text-[14px] text-muted transition-colors duration-150 hover:text-ink"
                  >
                    {title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <div className="max-w-[720px] min-w-0">
          <h1 className="font-display text-[clamp(34px,4.4vw,48px)] leading-[1.08] font-medium tracking-[-0.03em]">
            402reviews docs
          </h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            Google Reviews for AI agents, for x402 and MPP APIs.
          </p>
          {DOC_SECTIONS.map(({ id, title, blocks }) => (
            <section
              key={id}
              id={id}
              className="mt-14 scroll-mt-24 space-y-4 border-t border-line pt-8"
            >
              <h2 className="font-display text-[24px] font-medium tracking-[-0.02em]">
                {title}
              </h2>
              {blocks.map((block, i) => (
                <Content key={i} block={block} />
              ))}
            </section>
          ))}
        </div>
      </main>
    </SiteShell>
  )
}
