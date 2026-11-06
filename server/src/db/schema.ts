import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    agentRegistry: text("agent_registry").notNull(),
    agentId: text("agent_id").notNull(),
    endpoint: text("endpoint").notNull(),
    task: text("task").notNull(),
    outcome: text("outcome").notNull(),
    value: integer("value").notNull(),
    reviewer: text("reviewer").notNull(),
    // One review per payment: a settled payment can back only one review.
    paymentTransaction: text("payment_transaction").notNull().unique(),
    // The exact JSON served at the feedbackURI; documentHash is its keccak256.
    document: text("document").notNull(),
    documentHash: text("document_hash").notNull(),
    status: text("status").notNull().default("pending"),
    feedbackTransaction: text("feedback_transaction"),
    feedbackIndex: text("feedback_index"),
    // Set when a person approved this review with World ID: the approval used
    // and a hash of their app-specific World ID subject.
    humanVerified: boolean("human_verified").notNull().default(false),
    humanSubject: text("human_subject"),
    approvalId: text("approval_id"),
    // An extra review by a person who already has a counted one for this
    // agent and task, accepted only while ALLOW_REPEAT_HUMAN_REVIEWS is on.
    humanRepeat: boolean("human_repeat").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("reviews_agent_task_idx").on(table.agentId, table.task),
    // One counted review per person, agent and task (repeats aside).
    uniqueIndex("reviews_one_per_human_idx")
      .on(table.humanSubject, table.agentId, table.task)
      .where(sql`${table.humanVerified} and not ${table.humanRepeat}`),
  ]
)

// A request for a person to approve one agent action (publishing a counted
// review, or a payment above the spending cap) by signing in with World ID.
export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  agent: text("agent").notNull(),
  details: jsonb("details").$type<Record<string, string>>().notNull(),
  // pending → approved | denied | expired; approved → consumed (once).
  status: text("status").notNull().default("pending"),
  reason: text("reason"),
  // OpenID Connect state, nonce and PKCE verifier for the sign-in in progress.
  state: text("state").unique(),
  nonce: text("nonce"),
  codeVerifier: text("code_verifier"),
  humanSubject: text("human_subject"),
  acr: text("acr"),
  authTime: timestamp("auth_time", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
})
