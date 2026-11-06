import {
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
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

// The ERC-8004 calls the CLI makes on Hedera testnet, behind one interface so
// tests can swap in a fake chain.
export interface ReputationChain {
  // Identity registry reads, for resolving an endpoint to its agent.
  registry: PublicClient | { readContract: PublicClient["readContract"] }
  // Sends giveFeedback from the reviewer's key and waits for it to succeed.
  giveFeedback(
    privateKey: Hex,
    args: {
      agentId: bigint
      value: number
      tag1: string
      tag2: string
      endpoint: string
      feedbackURI: string
      feedbackHash: Hex
    }
  ): Promise<Hex>
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
    async giveFeedback(privateKey, args) {
      const wallet = createWalletClient({
        account: privateKeyToAccount(privateKey),
        chain,
        transport,
      })
      const hash = await wallet.writeContract({
        address: registry,
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
      })
      const receipt = await client.waitForTransactionReceipt({ hash })
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
