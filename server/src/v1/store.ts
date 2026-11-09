import { desc, eq, inArray, lt, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import {
  apiKeys,
  apiReviews,
  authCodes,
  endpointHealth,
  pendingReviews,
  serviceProfiles,
  usageEvents,
  usedProofs,
  users,
} from "../db/schema.ts"

export type ServiceProfile = typeof serviceProfiles.$inferSelect
export type PendingReview = typeof pendingReviews.$inferSelect
export type EndpointHealth = typeof endpointHealth.$inferSelect
export type ApiReview = typeof apiReviews.$inferSelect
export type NewApiReview = Omit<ApiReview, "createdAt">
export type ApiUser = typeof users.$inferSelect
export type AuthCode = typeof authCodes.$inferSelect
export type UsageEvent = Omit<typeof usageEvents.$inferSelect, "createdAt">

export class PaymentAlreadyReviewedError extends Error {
  constructor() {
    super("This payment already backs a review")
  }
}

export interface ApiReviewStore {
  insert(review: NewApiReview): Promise<ApiReview>
  listByDomains(domains: string[]): Promise<ApiReview[]>
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
  getProfiles(domains: string[]): Promise<Map<string, ServiceProfile>>
  saveProfile(profile: ServiceProfile): Promise<void>
  savePending(pending: PendingReview): Promise<void>
  getPending(id: string): Promise<PendingReview | null>
  deletePending(id: string): Promise<void>
  saveHealth(health: EndpointHealth): Promise<void>
  getHealth(urls: string[]): Promise<Map<string, EndpointHealth>>
  listHealthByDomains(domains: string[]): Promise<EndpointHealth[]>
  listHealthDomains(): Promise<string[]>
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
  const usage: UsageEvent[] = []
  const profiles = new Map<string, ServiceProfile>()
  const pending = new Map<string, PendingReview>()
  const health = new Map<string, EndpointHealth>()
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
      usage.push(event)
    },
    listUsage: async () => usage,
    close: async () => {},
  }
}
