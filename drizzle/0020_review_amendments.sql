CREATE TABLE "review_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"reference" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"refunded_at" timestamp with time zone NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_refunds_review_id_unique" UNIQUE("review_id"),
	CONSTRAINT "review_refunds_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "review_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"user_id" text NOT NULL,
	"result" text,
	"listing" text,
	"satisfaction" text,
	"problems" jsonb,
	"pay_again" text,
	"delivered" text,
	"note" text,
	"note_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "review_updates_review_idx" ON "review_updates" USING btree ("review_id");