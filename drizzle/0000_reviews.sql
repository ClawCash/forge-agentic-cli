CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_registry" text NOT NULL,
	"agent_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"task" text NOT NULL,
	"outcome" text NOT NULL,
	"value" integer NOT NULL,
	"reviewer" text NOT NULL,
	"payment_transaction" text NOT NULL,
	"document" text NOT NULL,
	"document_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"feedback_transaction" text,
	"feedback_index" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "reviews_payment_transaction_unique" UNIQUE("payment_transaction")
);
--> statement-breakpoint
CREATE INDEX "reviews_agent_task_idx" ON "reviews" USING btree ("agent_id","task");