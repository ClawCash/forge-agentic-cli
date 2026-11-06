import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  type Hex,
  http,
  keccak256,
  type PublicClient,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  HEDERA_TESTNET_REGISTRIES,
  reputationRegistryAbi,
} from "../../shared/src/erc8004.ts"
import { HEDERA_TESTNET } from "../../shared/src/networks.ts"

export interface FeedbackEntry {
  client: string
  feedbackIndex: string
  value: number
  tag1: string
  tag2: string
  revoked: boolean
}

export interface FeedbackArgs {
  agentId: bigint
  value: number
  tag1: string
  tag2: string
  endpoint: string
  feedbackURI: string
  feedbackHash: Hex
}

export interface SignedFeedback {
  hash: Hex
  raw: Hex
  from: Hex
  nonce: number
}

export class FeedbackDroppedError extends Error {
  constructor(hash: Hex) {
    super(
      `Feedback transaction ${hash} was replaced by another and never landed`
    )
  }
}

// How long to look for a transaction that may already have reached the
// network when sending it reported an error (Hedera's RPC relay can time out
// while the transaction still goes through).
const LANDING_GRACE_MS = 60_000

// The ERC-8004 calls the CLI makes on Hedera testnet, behind one interface so
// tests can swap in a fake chain.
export interface ReputationChain {
  // Identity registry reads, for resolving an endpoint to its agent.
  registry: PublicClient | { readContract: PublicClient["readContract"] }
  // Signs a giveFeedback transaction from the reviewer's key without sending
  // it, so the caller can keep it before it reaches the network.
  signFeedback(privateKey: Hex, args: FeedbackArgs): Promise<SignedFeedback>
  // Sends a signed giveFeedback transaction and waits for it to succeed.
  // Safe to call again with the same transaction (after a timeout, say): its
  // nonce lets it land at most once. Throws FeedbackDroppedError when another
  // transaction from the reviewer took that nonce, so it can never land.
  sendFeedback(signed: SignedFeedback): Promise<Hex>
  // Non-revoked feedback for an agent and task; all reviewers when
  // `clients` is empty.
  readFeedback(
    agentId: bigint,
    clients: string[],
    tag1: string
  ): Promise<FeedbackEntry[]>
}

export function hederaReputation(env = process.env): ReputationChain {
  const chain = HEDERA_TESTNET.evmChain
  const transport = http(env.HEDERA_RPC_URL ?? HEDERA_TESTNET.evmRpcUrl)
  const client = createPublicClient({ chain, transport })
  const registry = HEDERA_TESTNET_REGISTRIES.reputation
  return {
    registry: client,
    async signFeedback(privateKey, args) {
      const account = privateKeyToAccount(privateKey)
      const wallet = createWalletClient({ account, chain, transport })
      const request = await wallet.prepareTransactionRequest({
        to: registry,
        data: encodeFunctionData({
          abi: reputationRegistryAbi,
          functionName: "giveFeedback",
          args: [
            args.agentId,
            BigInt(args.value),
            0,
            args.tag1,
            args.tag2,
            args.endpoint,
            args.feedbackURI,
            args.feedbackHash,
          ],
        }),
      })
      const raw = await wallet.signTransaction(request)
      return {
        hash: keccak256(raw),
        raw,
        from: account.address,
        nonce: request.nonce,
      }
    },
    async sendFeedback(signed) {
      const { hash } = signed
      let receipt = await client
        .getTransactionReceipt({ hash })
        .catch(() => null)
      if (!receipt) {
        try {
          await client.sendRawTransaction({ serializedTransaction: signed.raw })
        } catch (error) {
          // The send may have failed only on the way back: look for it.
          receipt = await client
            .waitForTransactionReceipt({ hash, timeout: LANDING_GRACE_MS })
            .catch(() => null)
          if (!receipt) {
            const used = await client.getTransactionCount({
              address: signed.from,
            })
            if (used > signed.nonce) throw new FeedbackDroppedError(hash)
            throw error
          }
        }
      }
      receipt ??= await client.waitForTransactionReceipt({ hash })
      if (receipt.status !== "success") {
        throw new Error(`giveFeedback reverted: ${hash}`)
      }
      return hash
    },
    async readFeedback(agentId, clients, tag1) {
      const [addresses, indexes, values, decimals, tag1s, tag2s, revoked] =
        await client.readContract({
          address: registry,
          abi: reputationRegistryAbi,
          functionName: "readAllFeedback",
          args: [agentId, clients as Hex[], tag1, "", false],
        })
      return addresses.map((address, i) => ({
        client: address,
        feedbackIndex: indexes[i].toString(),
        value: Number(values[i]) / 10 ** decimals[i],
        tag1: tag1s[i],
        tag2: tag2s[i],
        revoked: revoked[i],
      }))
    },
  }
}
