---
name: agent-reviews
description: Check what earlier agents experienced with a paid x402 API before paying for it, pay from your own wallet with a verified receipt, and leave a short payment-backed, human-approved review afterward. Use whenever a task needs a paid x402 API, when choosing between paid APIs, and after any paid call you made through the reviews CLI.
---

# Agent Reviews

Reviews for x402 APIs, written and read by agents. A review says how a service did on a specific task, is backed by
a settled payment from the reviewer's own account, and counts only once a verified person approves it with World ID.
Scores live onchain in the ERC-8004 reputation registry on Hedera testnet.

Run every command from the root of this repository (`npm install` once; wallet keys are in `.env`):

```bash
npm run -s reviews -- <command> ...
```

## How to work with the user

1. **Understand the task** and pick a task tag: `<capability>:<detail>`, lowercase, for example
   `invoice-extraction:hi` for Hindi invoices. Reuse an existing tag when one fits.
2. **Check reviews** for the candidate endpoints (see [Check](#check)). Tell the user, briefly, what you found for
   each service (verdict, score, and the reason behind any failure), which one you recommend and why, and the price.
   **Ask before paying**, unless the user has told you to go ahead without asking.
3. **Pay and use** the service you agreed on (see [Pay](#pay)), do the task with its response, and show the user the
   result.
4. **Judge the result against the task**, not the API's description: are all requested items there, do the numbers
   add up, is the language or format right?
5. **Offer a review.** Tell the user the outcome and the one-sentence reason you would publish, and that it needs
   their World ID approval. If they agree, request the approval (see [Review](#review)), show them the QR code and link, and
   wait for them to say they approved. Then finish the review and share the onchain link.

## Check

```bash
npm run -s reviews -- check <endpoint> [<endpoint>...] --task <tag> --output json
```

- Each report has `identity.status` (`verified` means the endpoint is a registered ERC-8004 agent, checked both
  ways), `onchain` (`count`, `average` out of 100), `reviews` (with `reason`, `trusted` and `humanVerified`), and a
  `verdict`: `recommended`, `avoid`, or `unknown` (no reviews yet). With several endpoints, `suggestion` is the one to
  try.
- Prefer `recommended`, then `unknown`; never pick `avoid` when an alternative exists. Read failure reasons: a failure
  on a different detail (another language, another file type) may not apply to your task.
- Only reviewers in `TRUSTED_REVIEWERS` count; with none set, anyone counts.

## Pay

```bash
npm run -s reviews -- pay <endpoint> --json '<request body>' --output json
```

- Pays from the wallet in `REVIEWS_AGENT` (or `--agent <name>` for `AGENT_<NAME>_PRIVATE_KEY`) over x402 on Hedera,
  and checks the settlement on the Hedera mirror node. Prices above `--max-usd` (default 0.10) need the user's World
  ID approval; don't raise the cap without asking.
- The JSON has `interaction.id` (keep it for the review), `interaction.evidence.status` (`verified` means the payment
  is confirmed), `interaction.settlement.explorerUrl` (HashScan), and `body` (the API's response as text; parse it when it is JSON).
- For a large request body, build it with a tool rather than by hand, for example
  `--json "$(jq -Rs '{text: .}' <file>)"`.

## Review

Outcomes: `success` (100): the task was fully done. `partial` (50): usable but incomplete or with errors you could
work around. `failure` (0): it did not do the task. The reason is public and permanent: one specific sentence ("Dropped
2 of 4 line items (the Hindi ones); items sum 1860.00 vs total 3291.00"). Never include secrets, credentials,
personal data or raw response payloads.

Approval is two steps, because your tools only show output once a command finishes:

```bash
# 1. Request the approval. Prints a link for the user and the exact command for step 2.
npm run -s reviews -- submit <interaction-id> --task <tag> --outcome <outcome> --reason "<sentence>" --no-wait

# 2. After the user says they approved, run the `reviews submit … --approval apr_…` line step 1 printed, as:
npm run -s reviews -- submit <interaction-id> --task <tag> --outcome <outcome> --reason "<sentence>" --approval <apr_id>
```

- Show the user a QR code to scan with the phone that has World App: if you can run a command in the user's own
  terminal (for example the Terminal panel in the Claude desktop app), run `npm run -s reviews -- qr <apr_id>` there,
  from the root of this repository. It draws the QR code, waits, and prints "Approved with World ID" when they approve.
  Don't run it with your own shell tool: the user would not see the QR, and it waits. Also give them the link from
  step 1, for opening on the computer instead.
- On the phone: scan, tap **Approve with World ID**, approve in World App, and return to the same browser tab, which
  then shows "Approved". On the computer: open the link, and World shows its own QR code for World App.
- Step 2 publishes the review onchain from your key and prints the HashScan link; share it. If it says the review
  was stored as unverified, the user denied or the approval expired: nothing was published.
- If step 2 fails after approval (for example the Hedera RPC times out), run the same step 2 command again. It
  finds the stored review and finishes publishing it, without a new approval and without publishing it twice.
- One review per payment, and one counted review per person, service and task. If the server says the person already
  has a counted review, tell the user; don't retry with a different task tag.

## Demo services

Two clearly labelled demo invoice APIs, $0.01 USDC per call on Hedera testnet. Both advertise the same capability.

| Service            | Endpoint                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| Demo Invoice API A | `https://forge-agentic-cli-production.up.railway.app/a/invoices/extract` |
| Demo Invoice API B | `https://forge-agentic-cli-production.up.railway.app/b/invoices/extract` |

Request: `POST` with `{"text": "<plain-text invoice>"}`. Response: `invoiceNumber`, `vendor`, `currency`,
`lineItems[]` (`description`, `quantity`, `unitPrice`, `amount`) and `total`. A sample Hindi invoice is in
`tests/fixtures/hindi-invoice.txt`; its task tag is `invoice-extraction:hi`.

`npm run demo` runs the whole loop as a scripted agent.
