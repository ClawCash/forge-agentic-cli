import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import {
  adminSessions,
  apiKeys,
  apiReviews,
  authCodes,
  endpointHealth,
  merchantClaims,
  merchantProfiles,
  merchantSessions,
  paymentFailures,
  pendingReviews,
  providerKeys,
  seedingRequests,
  serviceProfiles,
  usageEvents,
  usedProofs,
  users,
} from "../db/schema.ts"

export type ServiceProfile = typeof serviceProfiles.$inferSelect
export type PendingReview = typeof pendingReviews.$inferSelect
export type EndpointHealth = typeof endpointHealth.$inferSelect
export type PaymentFailure = typeof paymentFailures.$inferSelect
export type ApiReview = typeof apiReviews.$inferSelect
export type NewApiReview = Omit<ApiReview, "createdAt">
export type ApiUser = typeof users.$inferSelect
export type AuthCode = typeof authCodes.$inferSelect
export type UsageEvent = Omit<typeof usageEvents.$inferSelect, "createdAt">
export type AdminSession = typeof adminSessions.$inferSelect
export type MerchantSession = typeof merchantSessions.$inferSelect
export type MerchantClaim = typeof merchantClaims.$inferSelect
export type MerchantProfile = typeof merchantProfiles.$inferSelect
export type SeedingRequest = typeof seedingRequests.$inferSelect
export type ProviderKey = typeof providerKeys.$inferSelect
// Requests per UTC day ("YYYY-MM-DD"), account and kind.
export interface UsageDay {
  day: string
  userId: string | null
  kind: string
  requests: number
}
export interface UsageUser {
  userId: string
  lastAt: Date
  requests: number
}
export interface UsageClient {
  client: string | null
  requests: number
}

export class PaymentAlreadyReviewedError extends Error {
  constructor() {
    super("This payment already backs a review")
  }
}

export interface ApiReviewStore {
  insert(review: NewApiReview): Promise<ApiReview>
  listByDomains(domains: string[]): Promise<ApiReview[]>
  listBySubdomains(domains: string[]): Promise<ApiReview[]>
  listByTask(task: string): Promise<ApiReview[]>
  usedReferences(references: string[]): Promise<Set<string>>
  // Records a proof as spent. False if it had already been used.
  useProof(key: string, expiresAt: Date): Promise<boolean>
  listRecent(limit: number): Promise<ApiReview[]>

  getCode(email: string): Promise<AuthCode | null>
  saveCode(code: AuthCode): Promise<void>
  bumpCodeAttempts(email: string): Promise<void>
  deleteCode(email: string): Promise<void>
  upsertUser(user: { id: string; email: string }): Promise<ApiUser>
  insertKey(keyHash: string, userId: string): Promise<void>
  deleteKey(keyHash: string): Promise<void>
  userForKey(keyHash: string): Promise<ApiUser | null>
  setAutoReview(userId: string, enabled: boolean): Promise<ApiUser>
  recordUsage(event: UsageEvent): Promise<void>
  listUsage(): Promise<UsageEvent[]>
  // For the admin dashboard.
  listUsers(): Promise<ApiUser[]>
  usageByDay(since: Date): Promise<UsageDay[]>
  usageByUser(): Promise<UsageUser[]>
  usageClients(since: Date, limit: number): Promise<UsageClient[]>
  saveAdminSession(session: Omit<AdminSession, "createdAt">): Promise<void>
  adminSession(tokenHash: string): Promise<AdminSession | null>
  deleteAdminSession(tokenHash: string): Promise<void>
  // Merchants: sign-in, domain claims, profiles and seeding requests.
  saveMerchantSession(
    session: Omit<MerchantSession, "createdAt">
  ): Promise<void>
  merchantSession(tokenHash: string): Promise<MerchantSession | null>
  deleteMerchantSession(tokenHash: string): Promise<void>
  // Keys for the providers MCP. Lookups skip revoked keys.
  insertProviderKey(
    key: Omit<ProviderKey, "createdAt" | "lastUsedAt" | "revokedAt">
  ): Promise<void>
  providerKey(keyHash: string): Promise<ProviderKey | null>
  providerKeys(email: string): Promise<ProviderKey[]>
  revokeProviderKey(id: string, email: string): Promise<boolean>
  touchProviderKey(id: string): Promise<void>
  claimsFor(filter: {
    email?: string
    domain?: string
  }): Promise<MerchantClaim[]>
  saveClaim(claim: MerchantClaim): Promise<void>
  merchantProfiles(domains: string[]): Promise<Map<string, MerchantProfile>>
  saveMerchantProfile(profile: MerchantProfile): Promise<void>
  insertSeedingRequest(request: SeedingRequest): Promise<void>
  seedingRequests(filter?: {
    email?: string
    domain?: string
  }): Promise<SeedingRequest[]>
  setSeedingStatus(id: string, status: string): Promise<SeedingRequest | null>
  getProfiles(domains: string[]): Promise<Map<string, ServiceProfile>>
  saveProfile(profile: ServiceProfile): Promise<void>
  savePending(pending: PendingReview): Promise<void>
  getPending(id: string): Promise<PendingReview | null>
  deletePending(id: string): Promise<void>
  saveHealth(health: EndpointHealth): Promise<void>
  getHealth(urls: string[]): Promise<Map<string, EndpointHealth>>
  listHealthByDomains(domains: string[]): Promise<EndpointHealth[]>
  listHealthDomains(): Promise<string[]>
  insertPaymentFailure(
    report: Omit<PaymentFailure, "createdAt">
  ): Promise<PaymentFailure>
  listPaymentFailures(domains?: string[]): Promise<PaymentFailure[]>
  close(): Promise<void>
}

export async function postgresApiReviewStore(
  databaseUrl: string
): Promise<ApiReviewStore> {
  const client = postgres(databaseUrl, { max: 5, onnotice: () => {} })
  const db = drizzle(client)
  await migrate(db, {
    migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname,
  })
  return {
    async insert(review) {
      try {
        const [row] = await db.insert(apiReviews).values(review).returning()
        return row
      } catch (error) {
        const pg =
          (error as { cause?: Record<string, string> }).cause ??
          (error as Record<string, string>)
        if (pg?.code === "23505") throw new PaymentAlreadyReviewedError()
        throw error
      }
    },
    listBySubdomains: (domains) =>
      domains.length
        ? db
            .select()
            .from(apiReviews)
            .where(
              or(
                ...domains.map((domain) =>
                  like(apiReviews.domain, `%.${domain}`)
                )
              )
            )
            .orderBy(desc(apiReviews.createdAt))
        : Promise.resolve([]),
    listByDomains: (domains) =>
      domains.length
        ? db
            .select()
            .from(apiReviews)
            .where(inArray(apiReviews.domain, domains))
            .orderBy(desc(apiReviews.createdAt))
        : Promise.resolve([]),
    listByTask: (task) =>
      db
        .select()
        .from(apiReviews)
        .where(eq(apiReviews.task, task))
        .orderBy(desc(apiReviews.createdAt))
        .limit(2000),
    async usedReferences(references) {
      if (references.length === 0) return new Set()
      const rows = await db
        .select({ reference: apiReviews.paymentReference })
        .from(apiReviews)
        .where(inArray(apiReviews.paymentReference, references))
      return new Set(rows.map((row) => row.reference))
    },
    async useProof(key, expiresAt) {
      await db.delete(usedProofs).where(lt(usedProofs.expiresAt, sql`now()`))
      const rows = await db
        .insert(usedProofs)
        .values({ key, expiresAt })
        .onConflictDoNothing()
        .returning({ key: usedProofs.key })
      return rows.length === 1
    },
    listRecent: (limit) =>
      db
        .select()
        .from(apiReviews)
        .orderBy(desc(apiReviews.createdAt))
        .limit(limit),
    async savePending(pending) {
      await db
        .delete(pendingReviews)
        .where(lt(pendingReviews.expiresAt, sql`now()`))
      await db.insert(pendingReviews).values(pending)
    },
    async getPending(id) {
      const [row] = await db
        .select()
        .from(pendingReviews)
        .where(eq(pendingReviews.id, id))
      return row ?? null
    },
    async deletePending(id) {
      await db.delete(pendingReviews).where(eq(pendingReviews.id, id))
    },
    async deleteKey(keyHash) {
      await db.delete(apiKeys).where(eq(apiKeys.keyHash, keyHash))
    },
    async saveHealth(health) {
      await db
        .insert(endpointHealth)
        .values(health)
        .onConflictDoUpdate({ target: endpointHealth.url, set: health })
    },
    async getHealth(urls) {
      if (urls.length === 0) return new Map()
      const rows = await db
        .select()
        .from(endpointHealth)
        .where(inArray(endpointHealth.url, urls))
      return new Map(rows.map((row) => [row.url, row]))
    },
    listHealthByDomains: (domains) =>
      domains.length
        ? db
            .select()
            .from(endpointHealth)
            .where(inArray(endpointHealth.domain, domains))
        : Promise.resolve([]),
    async listHealthDomains() {
      const rows = await db
        .selectDistinct({ domain: endpointHealth.domain })
        .from(endpointHealth)
      return rows.map((row) => row.domain)
    },
    async insertPaymentFailure(report) {
      const [row] = await db.insert(paymentFailures).values(report).returning()
      return row
    },
    listPaymentFailures: (domains) =>
      domains
        ? domains.length > 0
          ? db
              .select()
              .from(paymentFailures)
              .where(inArray(paymentFailures.domain, domains))
          : Promise.resolve([])
        : db
            .select()
            .from(paymentFailures)
            .orderBy(desc(paymentFailures.createdAt))
            .limit(5000),
    async getProfiles(domains) {
      if (domains.length === 0) return new Map()
      const rows = await db
        .select()
        .from(serviceProfiles)
        .where(inArray(serviceProfiles.domain, domains))
      return new Map(rows.map((row) => [row.domain, row]))
    },
    async saveProfile(profile) {
      await db
        .insert(serviceProfiles)
        .values(profile)
        .onConflictDoUpdate({ target: serviceProfiles.domain, set: profile })
    },
    async getCode(email) {
      const [row] = await db
        .select()
        .from(authCodes)
        .where(eq(authCodes.email, email))
      return row ?? null
    },
    async saveCode(code) {
      await db
        .insert(authCodes)
        .values(code)
        .onConflictDoUpdate({ target: authCodes.email, set: code })
    },
    async bumpCodeAttempts(email) {
      await db
        .update(authCodes)
        .set({ attempts: sql`${authCodes.attempts} + 1` })
        .where(eq(authCodes.email, email))
    },
    async deleteCode(email) {
      await db.delete(authCodes).where(eq(authCodes.email, email))
    },
    async upsertUser(user) {
      const [row] = await db
        .insert(users)
        .values(user)
        .onConflictDoUpdate({
          target: users.email,
          set: { lastSeenAt: new Date() },
        })
        .returning()
      return row
    },
    async insertKey(keyHash, userId) {
      await db.insert(apiKeys).values({ keyHash, userId })
    },
    async userForKey(keyHash) {
      const [row] = await db
        .select({ user: users })
        .from(apiKeys)
        .innerJoin(users, eq(apiKeys.userId, users.id))
        .where(eq(apiKeys.keyHash, keyHash))
      return row?.user ?? null
    },
    async setAutoReview(userId, enabled) {
      const [row] = await db
        .update(users)
        .set({ autoReview: enabled, autoReviewAt: new Date() })
        .where(eq(users.id, userId))
        .returning()
      return row
    },
    async recordUsage(event) {
      await db.insert(usageEvents).values(event)
    },
    listUsage: () => db.select().from(usageEvents),
    listUsers: () => db.select().from(users).orderBy(desc(users.createdAt)),
    usageByDay(since) {
      const day = sql<string>`to_char(${usageEvents.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`
      return db
        .select({
          day,
          userId: usageEvents.userId,
          kind: usageEvents.kind,
          requests: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .where(gte(usageEvents.createdAt, since))
        .groupBy(day, usageEvents.userId, usageEvents.kind)
    },
    async usageByUser() {
      const rows = await db
        .select({
          userId: usageEvents.userId,
          lastAt: sql<Date>`max(${usageEvents.createdAt})`.mapWith(
            usageEvents.createdAt
          ),
          requests: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .where(isNotNull(usageEvents.userId))
        .groupBy(usageEvents.userId)
      return rows.map((row) => ({ ...row, userId: row.userId as string }))
    },
    usageClients: (since, limit) =>
      db
        .select({
          client: usageEvents.client,
          requests: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .where(gte(usageEvents.createdAt, since))
        .groupBy(usageEvents.client)
        .orderBy(desc(sql`count(*)`))
        .limit(limit),
    async saveAdminSession(session) {
      await db
        .delete(adminSessions)
        .where(lt(adminSessions.expiresAt, sql`now()`))
      await db.insert(adminSessions).values(session)
    },
    async adminSession(tokenHash) {
      const [row] = await db
        .select()
        .from(adminSessions)
        .where(eq(adminSessions.tokenHash, tokenHash))
      return row ?? null
    },
    async deleteAdminSession(tokenHash) {
      await db
        .delete(adminSessions)
        .where(eq(adminSessions.tokenHash, tokenHash))
    },
    async saveMerchantSession(session) {
      await db
        .delete(merchantSessions)
        .where(lt(merchantSessions.expiresAt, sql`now()`))
      await db.insert(merchantSessions).values(session)
    },
    async merchantSession(tokenHash) {
      const [row] = await db
        .select()
        .from(merchantSessions)
        .where(eq(merchantSessions.tokenHash, tokenHash))
      return row ?? null
    },
    async deleteMerchantSession(tokenHash) {
      await db
        .delete(merchantSessions)
        .where(eq(merchantSessions.tokenHash, tokenHash))
    },
    async insertProviderKey(key) {
      await db.insert(providerKeys).values(key)
    },
    async providerKey(keyHash) {
      const [row] = await db
        .select()
        .from(providerKeys)
        .where(
          and(eq(providerKeys.keyHash, keyHash), isNull(providerKeys.revokedAt))
        )
      return row ?? null
    },
    providerKeys: (email) =>
      db
        .select()
        .from(providerKeys)
        .where(and(eq(providerKeys.email, email), isNull(providerKeys.revokedAt)))
        .orderBy(desc(providerKeys.createdAt)),
    async revokeProviderKey(id, email) {
      const rows = await db
        .update(providerKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(providerKeys.id, id),
            eq(providerKeys.email, email),
            isNull(providerKeys.revokedAt)
          )
        )
        .returning({ id: providerKeys.id })
      return rows.length > 0
    },
    async touchProviderKey(id) {
      await db
        .update(providerKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(providerKeys.id, id))
    },
    claimsFor: ({ email, domain }) =>
      db
        .select()
        .from(merchantClaims)
        .where(
          and(
            email ? eq(merchantClaims.email, email) : undefined,
            domain ? eq(merchantClaims.domain, domain) : undefined
          )
        )
        .orderBy(desc(merchantClaims.createdAt)),
    async saveClaim(claim) {
      await db
        .insert(merchantClaims)
        .values(claim)
        .onConflictDoUpdate({ target: merchantClaims.id, set: claim })
    },
    async merchantProfiles(domains) {
      if (domains.length === 0) return new Map()
      const rows = await db
        .select()
        .from(merchantProfiles)
        .where(inArray(merchantProfiles.domain, domains))
      return new Map(rows.map((row) => [row.domain, row]))
    },
    async saveMerchantProfile(profile) {
      await db
        .insert(merchantProfiles)
        .values(profile)
        .onConflictDoUpdate({ target: merchantProfiles.domain, set: profile })
    },
    async insertSeedingRequest(request) {
      await db.insert(seedingRequests).values(request)
    },
    seedingRequests: (filter = {}) =>
      db
        .select()
        .from(seedingRequests)
        .where(
          and(
            filter.email ? eq(seedingRequests.email, filter.email) : undefined,
            filter.domain
              ? eq(seedingRequests.domain, filter.domain)
              : undefined
          )
        )
        .orderBy(desc(seedingRequests.createdAt))
        .limit(500),
    async setSeedingStatus(id, status) {
      const [row] = await db
        .update(seedingRequests)
        .set({ status, updatedAt: new Date() })
        .where(eq(seedingRequests.id, id))
        .returning()
      return row ?? null
    },
    close: () => client.end(),
  }
}

// Same behaviour without a database, for tests and local runs.
export function memoryApiReviewStore(): ApiReviewStore {
  const rows: ApiReview[] = []
  const proofs = new Map<string, Date>()
  const codes = new Map<string, AuthCode>()
  const accounts = new Map<string, ApiUser>()
  const keys = new Map<string, string>()
  const usage: (UsageEvent & { createdAt: Date })[] = []
  const sessions = new Map<string, AdminSession>()
  const merchantLogins = new Map<string, MerchantSession>()
  const providerKeyRows = new Map<string, ProviderKey>()
  const claims = new Map<string, MerchantClaim>()
  const merchantPages = new Map<string, MerchantProfile>()
  const seeding: SeedingRequest[] = []
  const profiles = new Map<string, ServiceProfile>()
  const pending = new Map<string, PendingReview>()
  const health = new Map<string, EndpointHealth>()
  const failures: PaymentFailure[] = []
  const newestFirst = (list: ApiReview[]) =>
    [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return {
    async insert(review) {
      if (rows.some((r) => r.paymentReference === review.paymentReference)) {
        throw new PaymentAlreadyReviewedError()
      }
      const row = { ...review, createdAt: new Date() }
      rows.push(row)
      return row
    },
    listBySubdomains: async (domains) =>
      newestFirst(
        rows.filter((row) =>
          domains.some((domain) => row.domain.endsWith(`.${domain}`))
        )
      ),
    listByDomains: async (domains) =>
      newestFirst(rows.filter((row) => domains.includes(row.domain))),
    listByTask: async (task) =>
      newestFirst(rows.filter((row) => row.task === task)),
    usedReferences: async (references) =>
      new Set(
        rows
          .map((row) => row.paymentReference)
          .filter((reference) => references.includes(reference))
      ),
    async useProof(key, expiresAt) {
      const now = new Date()
      for (const [k, at] of proofs) if (at < now) proofs.delete(k)
      if (proofs.has(key)) return false
      proofs.set(key, expiresAt)
      return true
    },
    listRecent: async (limit) => newestFirst(rows).slice(0, limit),
    getProfiles: async (domains) =>
      new Map(
        domains.flatMap((domain) => {
          const profile = profiles.get(domain)
          return profile ? [[domain, profile]] : []
        })
      ),
    async saveProfile(profile) {
      profiles.set(profile.domain, profile)
    },
    async savePending(review) {
      pending.set(review.id, review)
    },
    getPending: async (id) => pending.get(id) ?? null,
    async deletePending(id) {
      pending.delete(id)
    },
    async deleteKey(keyHash) {
      keys.delete(keyHash)
    },
    async saveHealth(row) {
      health.set(row.url, row)
    },
    getHealth: async (urls) =>
      new Map(
        urls.flatMap((url) => {
          const row = health.get(url)
          return row ? [[url, row]] : []
        })
      ),
    listHealthByDomains: async (domains) =>
      [...health.values()].filter((row) => domains.includes(row.domain)),
    listHealthDomains: async () => [
      ...new Set([...health.values()].map((row) => row.domain)),
    ],
    async insertPaymentFailure(report) {
      const row = { ...report, createdAt: new Date() }
      failures.push(row)
      return row
    },
    listPaymentFailures: async (domains) =>
      domains
        ? failures.filter((row) => domains.includes(row.domain))
        : [...failures],
    getCode: async (email) => codes.get(email) ?? null,
    async saveCode(code) {
      codes.set(code.email, code)
    },
    async bumpCodeAttempts(email) {
      const code = codes.get(email)
      if (code) codes.set(email, { ...code, attempts: code.attempts + 1 })
    },
    async deleteCode(email) {
      codes.delete(email)
    },
    async upsertUser({ id, email }) {
      const now = new Date()
      const user = accounts.get(email) ?? {
        id,
        email,
        createdAt: now,
        lastSeenAt: now,
        autoReview: false,
        autoReviewAt: null,
      }
      accounts.set(email, { ...user, lastSeenAt: now })
      return accounts.get(email) as ApiUser
    },
    async insertKey(keyHash, userId) {
      keys.set(keyHash, userId)
    },
    userForKey: async (keyHash) =>
      [...accounts.values()].find((u) => u.id === keys.get(keyHash)) ?? null,
    async setAutoReview(userId, enabled) {
      const user = [...accounts.values()].find((u) => u.id === userId)
      if (!user) throw new Error(`No user ${userId}`)
      const updated = { ...user, autoReview: enabled, autoReviewAt: new Date() }
      accounts.set(user.email, updated)
      return updated
    },
    async recordUsage(event) {
      usage.push({ ...event, createdAt: new Date() })
    },
    listUsage: async () => usage,
    listUsers: async () =>
      [...accounts.values()].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      ),
    async usageByDay(since) {
      const groups = new Map<string, UsageDay>()
      for (const event of usage) {
        if (event.createdAt < since) continue
        const day = event.createdAt.toISOString().slice(0, 10)
        const key = `${day}|${event.userId}|${event.kind}`
        const group = groups.get(key) ?? {
          day,
          userId: event.userId,
          kind: event.kind,
          requests: 0,
        }
        group.requests += 1
        groups.set(key, group)
      }
      return [...groups.values()]
    },
    async usageByUser() {
      const groups = new Map<string, UsageUser>()
      for (const event of usage) {
        if (!event.userId) continue
        const group = groups.get(event.userId) ?? {
          userId: event.userId,
          lastAt: event.createdAt,
          requests: 0,
        }
        group.requests += 1
        if (event.createdAt > group.lastAt) group.lastAt = event.createdAt
        groups.set(event.userId, group)
      }
      return [...groups.values()]
    },
    async usageClients(since, limit) {
      const counts = new Map<string | null, number>()
      for (const event of usage) {
        if (event.createdAt < since) continue
        counts.set(event.client, (counts.get(event.client) ?? 0) + 1)
      }
      return [...counts]
        .map(([client, requests]) => ({ client, requests }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, limit)
    },
    async saveAdminSession(session) {
      sessions.set(session.tokenHash, { ...session, createdAt: new Date() })
    },
    adminSession: async (tokenHash) => sessions.get(tokenHash) ?? null,
    async deleteAdminSession(tokenHash) {
      sessions.delete(tokenHash)
    },
    async saveMerchantSession(session) {
      merchantLogins.set(session.tokenHash, {
        ...session,
        createdAt: new Date(),
      })
    },
    merchantSession: async (tokenHash) => merchantLogins.get(tokenHash) ?? null,
    async deleteMerchantSession(tokenHash) {
      merchantLogins.delete(tokenHash)
    },
    async insertProviderKey(key) {
      providerKeyRows.set(key.id, {
        ...key,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      })
    },
    providerKey: async (keyHash) =>
      [...providerKeyRows.values()].find(
        (key) => key.keyHash === keyHash && !key.revokedAt
      ) ?? null,
    providerKeys: async (email) =>
      [...providerKeyRows.values()]
        .filter((key) => key.email === email && !key.revokedAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    async revokeProviderKey(id, email) {
      const key = providerKeyRows.get(id)
      if (!key || key.email !== email || key.revokedAt) return false
      providerKeyRows.set(id, { ...key, revokedAt: new Date() })
      return true
    },
    async touchProviderKey(id) {
      const key = providerKeyRows.get(id)
      if (key) providerKeyRows.set(id, { ...key, lastUsedAt: new Date() })
    },
    claimsFor: async ({ email, domain }) =>
      [...claims.values()]
        .filter(
          (claim) =>
            (!email || claim.email === email) &&
            (!domain || claim.domain === domain)
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    async saveClaim(claim) {
      const verified = [...claims.values()].find(
        (other) =>
          other.id !== claim.id &&
          other.domain === claim.domain &&
          other.status === "verified"
      )
      if (verified && claim.status === "verified") {
        throw new Error("This domain is already verified by someone else")
      }
      claims.set(claim.id, claim)
    },
    merchantProfiles: async (domains) =>
      new Map(
        domains.flatMap((domain) => {
          const profile = merchantPages.get(domain)
          return profile ? [[domain, profile]] : []
        })
      ),
    async saveMerchantProfile(profile) {
      merchantPages.set(profile.domain, profile)
    },
    async insertSeedingRequest(request) {
      seeding.push(request)
    },
    seedingRequests: async (filter = {}) =>
      seeding
        .filter(
          (request) =>
            (!filter.email || request.email === filter.email) &&
            (!filter.domain || request.domain === filter.domain)
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    async setSeedingStatus(id, status) {
      const request = seeding.find((row) => row.id === id)
      if (!request) return null
      request.status = status
      request.updatedAt = new Date()
      return request
    },
    close: async () => {},
  }
}
