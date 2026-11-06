import { and, desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { reviews } from "./schema.ts"

export type StoredReview = typeof reviews.$inferSelect
export type NewReview = Omit<
  typeof reviews.$inferInsert,
  | "status"
  | "createdAt"
  | "publishedAt"
  | "feedbackTransaction"
  | "feedbackIndex"
>

export class DuplicateReviewError extends Error {
  constructor() {
    super("This payment already backs a review")
  }
}

export interface ReviewStore {
  insert(review: NewReview): Promise<StoredReview>
  get(id: string): Promise<StoredReview | null>
  markPublished(
    id: string,
    publication: { feedbackTransaction: string; feedbackIndex: string }
  ): Promise<StoredReview>
  list(filter: { agentId: string; task?: string }): Promise<StoredReview[]>
  close(): Promise<void>
}

export async function postgresStore(databaseUrl: string): Promise<ReviewStore> {
  const client = postgres(databaseUrl, { max: 5 })
  const db = drizzle(client)
  await migrate(db, {
    migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname,
  })
  return {
    async insert(review) {
      try {
        const [row] = await db.insert(reviews).values(review).returning()
        return row
      } catch (error) {
        if (
          (error as { code?: string }).code === "23505" ||
          (error as { cause?: { code?: string } }).cause?.code === "23505"
        ) {
          throw new DuplicateReviewError()
        }
        throw error
      }
    },
    async get(id) {
      const [row] = await db.select().from(reviews).where(eq(reviews.id, id))
      return row ?? null
    },
    async markPublished(id, publication) {
      const [row] = await db
        .update(reviews)
        .set({ ...publication, status: "published", publishedAt: new Date() })
        .where(eq(reviews.id, id))
        .returning()
      return row
    },
    async list({ agentId, task }) {
      return db
        .select()
        .from(reviews)
        .where(
          task
            ? and(eq(reviews.agentId, agentId), eq(reviews.task, task))
            : eq(reviews.agentId, agentId)
        )
        .orderBy(desc(reviews.createdAt))
    },
    close: () => client.end(),
  }
}

// Same behaviour without a database, for tests and local runs.
export function memoryStore(): ReviewStore {
  const rows = new Map<string, StoredReview>()
  return {
    async insert(review) {
      for (const row of rows.values()) {
        if (row.paymentTransaction === review.paymentTransaction) {
          throw new DuplicateReviewError()
        }
      }
      const row: StoredReview = {
        ...review,
        status: "pending",
        feedbackTransaction: null,
        feedbackIndex: null,
        createdAt: new Date(),
        publishedAt: null,
      }
      rows.set(row.id, row)
      return row
    },
    async get(id) {
      return rows.get(id) ?? null
    },
    async markPublished(id, publication) {
      const row = rows.get(id)
      if (!row) throw new Error(`No review ${id}`)
      const updated = {
        ...row,
        ...publication,
        status: "published",
        publishedAt: new Date(),
      }
      rows.set(id, updated)
      return updated
    },
    async list({ agentId, task }) {
      return [...rows.values()]
        .filter(
          (row) => row.agentId === agentId && (!task || row.task === task)
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    },
    close: async () => {},
  }
}
