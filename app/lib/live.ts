// Real records from the live run on Hedera testnet (6 November 2026).

export const REPO_URL = "https://github.com/ClawCash/forge-agentic-cli"
export const FORGE_URL = "https://forgeintel.co"
export const SERVER_URL = "https://reviews-api.forgeintel.co"

const hashscan = (id: string) => `https://hashscan.io/testnet/transaction/${id}`

export const LIVE = {
  apiA: {
    name: "Invoice API A",
    agentId: 169,
    endpoint: `${SERVER_URL}/a/invoices/extract`,
    registration: hashscan(
      "0xa5569d5aa171346d22034660772ac117927134741f08942166b3a42bcf2c8226"
    ),
  },
  apiB: {
    name: "Invoice API B",
    agentId: 170,
    endpoint: `${SERVER_URL}/b/invoices/extract`,
    registration: hashscan(
      "0xf3738917c0b6c66b6152f94f672e5282f086b1e0043986a2b7407f5f33cda93d"
    ),
  },
  payments: {
    agentA: hashscan("0.0.9185802@1793998039.399470887"),
    agentB: hashscan("0.0.9185802@1793999316.414749407"),
  },
  reviews: {
    humanApproved: {
      tx: hashscan(
        "0x20cf5f25508148b65c67df4e2f44b439adb1b9f0b5be6412f85f4f3579a235bd"
      ),
      document: `${SERVER_URL}/reviews/rev_8749a877-e6d1-4081-8f81-d4a18e9c00f3.json`,
    },
    // Agent B's review of API B, approved with World ID.
    agentB: hashscan(
      "0x21353c9a4fe46dc067109834072302f8f6869a5e053aa515e279afe82ddf1efc"
    ),
  },
}

// The human-approved review as it appears in the review document (trimmed).
export const LIVE_REVIEW = {
  service: "Invoice API A",
  task: "invoice-extraction:hi",
  outcome: "failure",
  value: 0,
  reason:
    "Dropped 2 of 4 line items (the two Hindi ones); line items sum 1860.00 vs stated total 3291.00",
  json: {
    agentRegistry: "eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    agentId: 169,
    clientAddress: "0x6c259ee820b03a8a48209E66f16CC3fD399d9a96",
    value: 0,
    tag1: "invoice-extraction:hi",
    tag2: "failure",
    proofOfPayment: {
      chainId: "hedera:testnet",
      txHash: "0.0.9185802@1794000577.319893163",
      amount: "10000",
    },
    evidence: {
      payment: "verified on the Hedera mirror node",
      reviewerIsPayer: true,
      humanApproval: {
        verified: true,
        provider: "World ID Agent Pass",
        acr: "https://world.org/oidc/acr/orb",
      },
    },
  },
}
