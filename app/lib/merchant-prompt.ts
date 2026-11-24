import type { Claim } from "@/lib/merchant"

// A prompt the merchant pastes into Claude Code, Codex or Cursor in their
// API's repo. The agent proves ownership with whichever method it can reach.
export function verifyPrompt(claim: Claim) {
  const v = claim.verification
  if (!v) return ""
  return `Help me prove I own ${claim.domain} so I can claim it on 402reviews. Use whichever of these two you can do from here.

Option 1, DNS (preferred). Add a TXT record:
  Name:  ${v.dns.name}
  Value: ${v.dns.value}
If the DNS is managed in this repo or through a CLI you can use (Cloudflare, Vercel, Route 53, Terraform and so on), add it there. If not, tell me exactly where to add it and stop.

Option 2, a file on the API. Make this URL return the text below with status 200 and no redirect:
  URL:  ${v.file.url}
  Text: ${v.file.contents}
Add it as a static file or a small route in this API, then deploy it the way this project normally deploys.

Then check it is live:
  dig +short TXT ${v.dns.name}
  curl -s ${v.file.url}

Don't change anything else. When one of them shows the value, tell me, and I'll press Check now on providers.402reviews.xyz.`
}
