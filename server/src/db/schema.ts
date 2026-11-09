import { sql } from "drizzle-orm"
import {
  boolean,
  doublePrecision,
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

// Free, chain-agnostic reviews (the /v1 API). Each review is filed against one
// endpoint (`path`) and rolled up to its `domain`, and is backed by one settled
// payment from the reviewing wallet.
export const apiReviews = pgTable(
  "api_reviews",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(),
    path: text("path").notNull(),
    url: text("url").notNull(),
    task: text("task").notNull(),
    language: text("language"),
    format: text("format"),
    result: text("result").notNull(),
    listing: text("listing").notNull(),
    // Whether the call got the agent or its user to the outcome they needed,
    // and who said so.
    satisfaction: text("satisfaction").notNull(),
    satisfactionFrom: text("satisfaction_from").notNull().default("agent"),
    problems: jsonb("problems").$type<string[]>().notNull().default([]),
    checked: text("checked"),
    payAgain: text("pay_again"),
    tries: integer("tries"),
    note: text("note"),
    // "clean" notes are served; "held" notes looked like instructions or
    // personal data and are kept for moderation only.
    noteStatus: text("note_status").notNull().default("none"),
    wallet: text("wallet").notNull(),
    network: text("network").notNull(),
    // One review per settled payment.
    paymentReference: text("payment_reference").notNull().unique(),
    asset: text("asset").notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    priceUsd: doublePrecision("price_usd"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    proofMethod: text("proof_method").notNull(),
    userId: text("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("api_reviews_domain_idx").on(table.domain),
    index("api_reviews_task_idx").on(table.task),
  ]
)

// Wallet proofs already spent, so a captured proof can't be replayed.
export const usedProofs = pgTable("used_proofs", {
  key: text("key").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
})

// Reviewers sign up with an email and a one-time code.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // The user's standing permission to post reviews without being asked, and
  // when they gave it.
  autoReview: boolean("auto_review").notNull().default(false),
  autoReviewAt: timestamp("auto_review_at", { withTimezone: true }),
})

export const authCodes = pgTable("auth_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
})

// Only the hash of an API key is stored.
export const apiKeys = pgTable("api_keys", {
  keyHash: text("key_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// One row per API request. No request or response content.
export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    kind: text("kind").notNull(),
    task: text("task"),
    domain: text("domain"),
    status: integer("status").notNull(),
    client: text("client"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("usage_events_user_idx").on(table.userId),
    index("usage_events_created_idx").on(table.createdAt),
  ]
)

// What an API's own site says about it, for its leaderboard card.
export const serviceProfiles = pgTable("service_profiles", {
  domain: text("domain").primaryKey(),
  name: text("name"),
  description: text("description"),
  iconType: text("icon_type"),
  iconData: text("icon_data"),
  // Where the site really answers, which isn't always the bare domain.
  siteUrl: text("site_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
})
