import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import {
  buildSIWxSchema,
  parseSIWxHeader,
  SIGN_IN_WITH_X,
  validateSIWxMessage,
  verifySIWxSignature,
} from "@x402/extensions/sign-in-with-x"
import { Credential } from "mppx"
import { Mppx, tempo } from "mppx/server"
import {
  createPublicClient,
  type Hex,
  http,
  isHex,
  verifyTypedData,
} from "viem"
import { BASE, SOLANA, TEMPO, USDC_BASE } from "./chains.ts"

// Proves which wallet is writing a review, for any x402 or MPP client:
//   - wallet sign-in (SIWX), for AgentCash, SDKs and anything that can sign;
//   - a zero-amount MPP proof, for MPP clients;
//   - for clients that can only pay, a $0.000001 payment authorization that
//     proves the wallet and is never submitted.
// Reviewing is free: this module verifies signatures and never settles.

const CHALLENGE_SECONDS = 300
const PROOF_ACCOUNT = "0x000000000000000000000000000000000000dEaD"
const PROOF_AMOUNT = "1"

export type ProofMethod = "siwx" | "mpp-proof" | "x402-authorization"

export type WalletProof =
  | {
      status: "verified"
      wallet: string
      method: ProofMethod
      headers?: Headers
    }
  | { status: "invalid"; reason: string }
  | { status: "challenge"; response: Response }

export interface ProofDeps {
  baseUrl: string
  secret: string
  baseRpcUrl?: string
  // Returns false if this proof was already used.
  useProof(key: string, expiresAt: Date): Promise<boolean>
}

const hmac = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("hex").slice(0, 32)

// Stateless nonces: anyone can ask for a challenge, so issuing one must not
// write anything. Only a nonce that was actually used gets stored.
function issueNonce(secret: string, expiresAt: number) {
  const body = `${randomBytes(12).toString("hex")}${expiresAt.toString(16)}`
  return `${body}${hmac(secret, body)}`
}

function checkNonce(secret: string, nonce: string) {
  if (!/^[0-9a-f]+$/.test(nonce) || nonce.length <= 32) return false
  const body = nonce.slice(0, -32)
  const expected = Buffer.from(hmac(secret, body))
  const given = Buffer.from(nonce.slice(-32))
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return false
  }
  return parseInt(body.slice(24), 16) > Date.now()
}

const TRANSFER_WITH_AUTHORIZATION = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const

export function walletProver(deps: ProofDeps) {
  const origin = new URL(deps.baseUrl)
  // Each proof is bound to the exact URL being opened, which is also what
  // clients check the challenge against.
  const resourceFor = (request: Request) =>
    `${deps.baseUrl}${new URL(request.url).pathname}`
  const base = createPublicClient({
    transport: http(deps.baseRpcUrl ?? "https://base-rpc.publicnode.com"),
  })
  const mppx = Mppx.create({
    methods: [
      tempo.charge({
        recipient: PROOF_ACCOUNT,
        currency: "0x20C000000000000000000000b9537d11c60E8b50",
      }),
    ],
    realm: origin.host,
    secretKey: deps.secret,
  })

  async function challenge(request: Request): Promise<Response> {
    const now = Date.now()
    const expiresAt = now + CHALLENGE_SECONDS * 1000
    const resource = resourceFor(request)
    const required = {
      x402Version: 2,
      error:
        "Prove the wallet that paid for the API you are reviewing. Reviewing is free.",
      resource: {
        url: resource,
        description:
          "Free. Proves the reviewing wallet; the authorization is never submitted.",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: BASE,
          amount: PROOF_AMOUNT,
          asset: USDC_BASE,
          payTo: PROOF_ACCOUNT,
          maxTimeoutSeconds: CHALLENGE_SECONDS,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
      extensions: {
        [SIGN_IN_WITH_X]: {
          info: {
            domain: origin.host,
            uri: resource,
            statement: "Sign in to post a free review of an API you paid for.",
            version: "1",
            nonce: issueNonce(deps.secret, expiresAt),
            issuedAt: new Date(now).toISOString(),
            expirationTime: new Date(expiresAt).toISOString(),
            resources: [resource],
          },
          supportedChains: [
            { chainId: BASE, type: "eip191" },
            { chainId: TEMPO, type: "eip191" },
            { chainId: SOLANA, type: "ed25519" },
          ],
          schema: buildSIWxSchema(),
        },
      },
    }
    const headers = new Headers({
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(required)).toString(
        "base64"
      ),
    })
    const mpp = await mppx.charge({ amount: "0" })(request)
    if (mpp.status === 402) {
      const header = mpp.challenge.headers.get("www-authenticate")
      if (header) headers.set("WWW-Authenticate", header)
    }
    // Current clients read the header; older ones read this version 1 body.
    const legacy = {
      x402Version: 1,
      error: required.error,
      accepts: required.accepts.map((accept) => ({
        scheme: accept.scheme,
        network: "base",
        maxAmountRequired: accept.amount,
        resource,
        description: required.resource.description,
        mimeType: required.resource.mimeType,
        payTo: accept.payTo,
        maxTimeoutSeconds: accept.maxTimeoutSeconds,
        asset: accept.asset,
        extra: accept.extra,
      })),
      extensions: required.extensions,
    }
    return new Response(JSON.stringify(legacy), { status: 402, headers })
  }

  async function fromSignIn(
    header: string,
    resource: string
  ): Promise<WalletProof> {
    let payload
    try {
      payload = parseSIWxHeader(header)
    } catch (error) {
      return { status: "invalid", reason: (error as Error).message }
    }
    const validation = await validateSIWxMessage(payload, new URL(resource), {
      checkNonce: (nonce) => checkNonce(deps.secret, nonce),
    })
    if (!validation.isValid) {
      return { status: "invalid", reason: validation.invalidMessage }
    }
    // Plain wallets verify offline; only smart wallets need the chain.
    let verified = await verifySIWxSignature(payload)
    if (!verified.isValid && payload.chainId.startsWith("eip155:")) {
      verified = await verifySIWxSignature(payload, {
        evmVerifier: base.verifyMessage,
      })
    }
    if (!verified.isValid) {
      return { status: "invalid", reason: verified.invalidMessage }
    }
    if (
      !(await deps.useProof(
        `siwx:${payload.nonce}`,
        new Date(Date.now() + CHALLENGE_SECONDS * 1000)
      ))
    ) {
      return { status: "invalid", reason: "This sign-in was already used" }
    }
    return { status: "verified", wallet: verified.payer, method: "siwx" }
  }

  async function fromAuthorization(header: string): Promise<WalletProof> {
    let payment: any
    try {
      payment = JSON.parse(Buffer.from(header, "base64").toString("utf8"))
    } catch {
      return { status: "invalid", reason: "Payment header is not valid" }
    }
    const authorization = payment?.payload?.authorization
    const signature = payment?.payload?.signature
    if (!authorization?.from || !isHex(signature)) {
      return {
        status: "invalid",
        reason: "Expected an EVM exact payment authorization",
      }
    }
    const now = Math.floor(Date.now() / 1000)
    const validBefore = Number(authorization.validBefore)
    if (
      authorization.to?.toLowerCase() !== PROOF_ACCOUNT.toLowerCase() ||
      String(authorization.value) !== PROOF_AMOUNT ||
      Number(authorization.validAfter) > now ||
      validBefore <= now ||
      validBefore > now + CHALLENGE_SECONDS + 60
    ) {
      return {
        status: "invalid",
        reason: "The authorization does not match this challenge",
      }
    }
    const typedData = {
      address: authorization.from as Hex,
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 8453,
        verifyingContract: USDC_BASE as Hex,
      },
      types: TRANSFER_WITH_AUTHORIZATION,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
      signature,
    } as const
    // Plain wallets verify offline; only smart wallets need the chain.
    const valid =
      (await verifyTypedData(typedData).catch(() => false)) ||
      (await base.verifyTypedData(typedData).catch(() => false))
    if (!valid) {
      return { status: "invalid", reason: "Wallet signature is not valid" }
    }
    if (
      !(await deps.useProof(
        `x402:${authorization.nonce}`,
        new Date((validBefore + 60) * 1000)
      ))
    ) {
      return { status: "invalid", reason: "This proof was already used" }
    }
    // Clients expect a settlement response; an empty transaction is how x402
    // says that nothing was broadcast.
    const settled = {
      success: true,
      transaction: "",
      network: BASE,
      payer: authorization.from,
    }
    return {
      status: "verified",
      wallet: authorization.from,
      method: "x402-authorization",
      headers: new Headers({
        "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(settled)).toString(
          "base64"
        ),
      }),
    }
  }

  async function fromMppProof(request: Request): Promise<WalletProof> {
    const credential = Credential.fromRequest(request)
    const result = await mppx.charge({ amount: "0" })(request)
    if (result.status === 402) {
      return { status: "invalid", reason: "MPP proof is not valid" }
    }
    const wallet = /^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$/.exec(
      credential.source ?? ""
    )?.[1]
    if (!wallet) {
      return { status: "invalid", reason: "MPP proof has no wallet source" }
    }
    const fresh = await deps.useProof(
      `mpp:${credential.challenge.id}`,
      new Date(Date.now() + CHALLENGE_SECONDS * 1000 * 2)
    )
    return fresh
      ? { status: "verified", wallet, method: "mpp-proof" }
      : { status: "invalid", reason: "This proof was already used" }
  }

  return async function prove(request: Request): Promise<WalletProof> {
    const headers = request.headers
    const signIn = headers.get("sign-in-with-x")
    if (signIn) return fromSignIn(signIn, resourceFor(request))
    const paid = headers.get("payment-signature") ?? headers.get("x-payment")
    if (paid) return fromAuthorization(paid)
    if (headers.get("authorization")?.toLowerCase().startsWith("payment ")) {
      return fromMppProof(request)
    }
    return { status: "challenge", response: await challenge(request) }
  }
}
