CREATE TABLE "api_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"path" text NOT NULL,
	"url" text NOT NULL,
	"task" text NOT NULL,
	"language" text,
	"format" text,
	"result" text NOT NULL,
	"listing" text NOT NULL,
	"satisfaction" text NOT NULL,
	"satisfaction_from" text DEFAULT 'agent' NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked" text,
	"pay_again" text,
	"tries" integer,
	"note" text,
	"note_status" text DEFAULT 'none' NOT NULL,
	"wallet" text NOT NULL,
	"network" text NOT NULL,
	"payment_reference" text NOT NULL,
	"asset" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"price_usd" double precision,
	"paid_at" timestamp with time zone NOT NULL,
	"proof_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_reviews_payment_reference_unique" UNIQUE("payment_reference")
);
--> statement-breakpoint
CREATE TABLE "used_proofs" (
	"key" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_reviews_domain_idx" ON "api_reviews" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "api_reviews_task_idx" ON "api_reviews" USING btree ("task");