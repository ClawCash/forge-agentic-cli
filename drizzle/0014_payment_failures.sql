CREATE TABLE "payment_failures" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"path" text NOT NULL,
	"task" text,
	"user_id" text NOT NULL,
	"error" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payment_failures_domain_idx" ON "payment_failures" USING btree ("domain");