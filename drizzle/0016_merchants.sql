CREATE TABLE "merchant_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "merchant_profiles" (
	"domain" text PRIMARY KEY NOT NULL,
	"name" text,
	"description" text,
	"docs_url" text,
	"spec_url" text,
	"pricing_url" text,
	"contact_email" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seeding_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"email" text NOT NULL,
	"endpoints" jsonb NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_claims_domain_email_idx" ON "merchant_claims" USING btree ("domain","email");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_claims_verified_idx" ON "merchant_claims" USING btree ("domain") WHERE "merchant_claims"."status" = 'verified';--> statement-breakpoint
CREATE INDEX "seeding_requests_domain_idx" ON "seeding_requests" USING btree ("domain");