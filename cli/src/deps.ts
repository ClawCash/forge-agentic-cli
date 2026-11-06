import type { EvidenceDeps } from "../../shared/src/evidence.ts"
import type { ReputationChain } from "./reputation.ts"

// Everything the commands touch outside the process, so tests can replace it.
export interface CliDeps {
  // HTTP for paid endpoints and the reviews server.
  fetch: typeof fetch
  env: NodeJS.ProcessEnv
  stdout: (text: string) => void
  stderr: (text: string) => void
  // Hedera mirror node access, for account lookups and the payment check.
  mirror?: EvidenceDeps
  // ERC-8004 on Hedera testnet.
  reputation: ReputationChain
  // Shows a human approval link (default: a QR code on stderr). Tests use it
  // to play the person.
  showApproval?: (approvalUrl: string) => void | Promise<void>
  pollMs?: number
  approvalTimeoutMs?: number
}
