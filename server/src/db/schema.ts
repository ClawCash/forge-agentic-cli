import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [index("reviews_agent_task_idx").on(table.agentId, table.task)]
)
