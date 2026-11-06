import { inspectHederaTransaction } from "@x402/hedera"
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  stringToBytes,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  HEDERA_TESTNET_REGISTRIES,
  reputationRegistryAbi,
} from "../../shared/src/erc8004.ts"
import { mirrorTransactionId } from "../../shared/src/hedera.ts"
import { FEE_PAYER, HEDERA } from "./payments.mjs"

// A tiny stand-in for Hedera: the facilitator "settles" the transfer the
// agent actually signed, and the mirror node then reports exactly that.
export function fakeLedger({ accounts }) {
  const transactions = new Map()
  let sequence = 0
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })

  const facilitator = {
    verify: async () => ({ isValid: true }),
    settle: async (payload, requirements) => {
      const tx = inspectHederaTransaction(payload.payload.transaction)
      const id = `${FEE_PAYER}@1731000000.${String(++sequence).padStart(9, "0")}`
      transactions.set(mirrorTransactionId(id), [
        {
          result: "SUCCESS",
          consensus_timestamp: `1731000001.${sequence}`,
          token_transfers: Object.entries(tx.tokenTransfers).flatMap(
            ([token, transfers]) =>
              transfers.map((t) => ({
                token_id: token,
                account: t.accountId,
                amount: Number(t.amount),
              }))
          ),
        },
      ])
      return { success: true, transaction: id, network: requirements.network }
    },
    getSupported: async () => ({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: HEDERA,
          extra: { feePayer: FEE_PAYER },
        },
      ],
      extensions: [],
      signers: {},
    }),
  }

  const mirror = {
    attempts: 1,
    delayMs: 0,
    fetch: async (url) => {
      const path = new URL(url).pathname
      const account = /^\/api\/v1\/accounts\/(.+)$/.exec(path)
      if (account) {
        const key = account[1].toLowerCase()
        const entry = Object.entries(accounts).find(
          ([address, id]) => address.toLowerCase() === key || id === account[1]
        )
        return entry
          ? json({ account: entry[1], evm_address: entry[0].toLowerCase() })
          : json({}, 404)
      }
      const tx = /^\/api\/v1\/transactions\/(.+)$/.exec(path)
      if (tx && transactions.has(tx[1])) {
        return json({ transactions: transactions.get(tx[1]) })
      }
      return json({}, 404)
    },
  }
  return { facilitator, mirror }
}

// A stand-in for the ERC-8004 registries on Hedera: identity reads, and
// giveFeedback that emits a real NewFeedback log the server can parse.
export function fakeReputation({ agentURIs, owner }) {
  const feedback = []
  const receipts = new Map()
  return {
    feedback,
    registry: {
      readContract: async ({ functionName, args: [id] }) => {
        const uri = agentURIs[Number(id)]
        if (!uri) throw new Error("ERC721NonexistentToken")
        return functionName === "tokenURI" ? uri : owner
      },
    },
    receipts: {
      getTransactionReceipt: async ({ hash }) => {
        if (!receipts.has(hash)) throw new Error("not found")
        return receipts.get(hash)
      },
    },
    async giveFeedback(privateKey, args) {
      const client = privateKeyToAccount(privateKey).address
      const index =
        BigInt(
          feedback.filter(
            (f) => f.agentId === args.agentId && f.client === client
          ).length
        ) + 1n
      const hash = keccak256(stringToBytes(`tx-${feedback.length}-${client}`))
      const log = {
        address: HEDERA_TESTNET_REGISTRIES.reputation,
        topics: encodeEventTopics({
          abi: reputationRegistryAbi,
          eventName: "NewFeedback",
          args: {
            agentId: args.agentId,
            clientAddress: client,
            indexedTag1: args.tag1,
          },
        }),
        data: encodeAbiParameters(
          [
            { type: "uint64" },
            { type: "int128" },
            { type: "uint8" },
            { type: "string" },
            { type: "string" },
            { type: "string" },
            { type: "string" },
            { type: "bytes32" },
          ],
          [
            index,
            BigInt(args.value),
            0,
            args.tag1,
            args.tag2,
            args.endpoint,
            args.feedbackURI,
            args.feedbackHash,
          ]
        ),
        blockNumber: 1n,
        transactionHash: hash,
        logIndex: 0,
        blockHash: `0x${"cd".repeat(32)}`,
        transactionIndex: 0,
        removed: false,
      }
      receipts.set(hash, { status: "success", logs: [log] })
      feedback.push({ ...args, client, index, hash })
      return hash
    },
    async readFeedback(agentId, clients, tag1) {
      const wanted = clients.map((c) => c.toLowerCase())
      return feedback
        .filter(
          (f) =>
            f.agentId === agentId &&
            f.tag1 === tag1 &&
            (wanted.length === 0 || wanted.includes(f.client.toLowerCase()))
        )
        .map((f) => ({
          client: f.client,
          feedbackIndex: f.index.toString(),
          value: f.value,
          tag1: f.tag1,
          tag2: f.tag2,
          revoked: false,
        }))
    },
  }
}
