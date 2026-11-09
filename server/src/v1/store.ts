import { desc, eq, inArray, lt, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { apiReviews, usedProofs } from "../db/schema.ts"

export type ApiReview = typeof apiReviews.$inferSelect
export type NewApiReview = Omit<ApiReview, "createdAt">

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
    close: () => client.end(),
  }
}

// Same behaviour without a database, for tests and local runs.
export function memoryApiReviewStore(): ApiReviewStore {
  const rows: ApiReview[] = []
  const proofs = new Map<string, Date>()
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
    close: async () => {},
  }
}
