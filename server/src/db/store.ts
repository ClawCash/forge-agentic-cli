import { and, desc, eq, gt } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { approvals, reviews } from "./schema.ts"

export type StoredReview = typeof reviews.$inferSelect
export type NewReview = Omit<
  typeof reviews.$inferInsert,
  | "status"
  | "createdAt"
  | "publishedAt"
  | "feedbackTransaction"
  | "feedbackIndex"
>
export type Approval = typeof approvals.$inferSelect
export type NewApproval = Pick<
  typeof approvals.$inferInsert,
  "id" | "action" | "agent" | "details" | "expiresAt"
>
export type ApprovalDecision =
  | {
      status: "approved"
      humanSubject: string
      acr: string | null
      authTime: Date
    }
  | { status: "denied" | "expired"; reason: string }

export class DuplicateReviewError extends Error {
  constructor() {
    super("This payment already backs a review")
  }
}

export class DuplicateHumanReviewError extends Error {
  constructor() {
    super("This person already has a counted review for this endpoint and task")
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

  createApproval(approval: NewApproval): Promise<Approval>
  getApproval(id: string): Promise<Approval | null>
  getApprovalByState(state: string): Promise<Approval | null>
  // Records the sign-in started for a pending approval.
  startApproval(
    id: string,
    signIn: { state: string; nonce: string; codeVerifier: string }
  ): Promise<Approval | null>
  // Settles a pending approval; returns null if it was no longer pending.
  decideApproval(
    id: string,
    decision: ApprovalDecision
  ): Promise<Approval | null>
  // Atomically turns an approved, unexpired approval into a consumed one, so
  // each approval authorizes exactly one action. Returns null otherwise.
  consumeApproval(id: string, now: Date): Promise<Approval | null>
  close(): Promise<void>
}

function duplicateError(error: unknown) {
  const pg =
    (error as { cause?: Record<string, string> }).cause ??
    (error as Record<string, string>)
  if (pg?.code !== "23505") return null
  return pg.constraint_name === "reviews_one_per_human_idx"
    ? new DuplicateHumanReviewError()
    : new DuplicateReviewError()
}

export async function postgresStore(databaseUrl: string): Promise<ReviewStore> {
  const client = postgres(databaseUrl, { max: 5, onnotice: () => {} })
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
        throw duplicateError(error) ?? error
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
    async createApproval(approval) {
      const [row] = await db.insert(approvals).values(approval).returning()
      return row
    },
    async getApproval(id) {
      const [row] = await db
        .select()
        .from(approvals)
        .where(eq(approvals.id, id))
      return row ?? null
    },
    async getApprovalByState(state) {
      const [row] = await db
        .select()
        .from(approvals)
        .where(eq(approvals.state, state))
      return row ?? null
    },
    async startApproval(id, signIn) {
      const [row] = await db
        .update(approvals)
        .set(signIn)
        .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
        .returning()
      return row ?? null
    },
    async decideApproval(id, decision) {
      const [row] = await db
        .update(approvals)
        .set({ ...decision, decidedAt: new Date() })
        .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
        .returning()
      return row ?? null
    },
    async consumeApproval(id, now) {
      const [row] = await db
        .update(approvals)
        .set({ status: "consumed", consumedAt: now })
        .where(
          and(
            eq(approvals.id, id),
            eq(approvals.status, "approved"),
            gt(approvals.expiresAt, now)
          )
        )
        .returning()
      return row ?? null
    },
    close: () => client.end(),
  }
}

// Same behaviour without a database, for tests and local runs.
export function memoryStore(): ReviewStore {
  const rows = new Map<string, StoredReview>()
  const approvalRows = new Map<string, Approval>()
  const update = (
    id: string,
    when: (a: Approval) => boolean,
    patch: Partial<Approval>
  ) => {
    const row = approvalRows.get(id)
    if (!row || !when(row)) return null
    const next = { ...row, ...patch }
    approvalRows.set(id, next)
    return next
  }
  return {
    async insert(review) {
      for (const row of rows.values()) {
        if (row.paymentTransaction === review.paymentTransaction) {
          throw new DuplicateReviewError()
        }
        if (
          review.humanVerified &&
          row.humanVerified &&
          row.humanSubject === review.humanSubject &&
          row.agentId === review.agentId &&
          row.task === review.task
        ) {
          throw new DuplicateHumanReviewError()
        }
      }
      const row: StoredReview = {
        humanVerified: false,
        humanSubject: null,
        approvalId: null,
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
    async createApproval(approval) {
      const row: Approval = {
        ...approval,
        status: "pending",
        reason: null,
        state: null,
        nonce: null,
        codeVerifier: null,
        humanSubject: null,
        acr: null,
        authTime: null,
        createdAt: new Date(),
        decidedAt: null,
        consumedAt: null,
      }
      approvalRows.set(row.id, row)
      return row
    },
    async getApproval(id) {
      return approvalRows.get(id) ?? null
    },
    async getApprovalByState(state) {
      return [...approvalRows.values()].find((a) => a.state === state) ?? null
    },
    async startApproval(id, signIn) {
      return update(id, (a) => a.status === "pending", signIn)
    },
    async decideApproval(id, decision) {
      return update(id, (a) => a.status === "pending", {
        ...decision,
        decidedAt: new Date(),
      })
    },
    async consumeApproval(id, now) {
      return update(id, (a) => a.status === "approved" && a.expiresAt > now, {
        status: "consumed",
        consumedAt: now,
      })
    },
    close: async () => {},
  }
}
