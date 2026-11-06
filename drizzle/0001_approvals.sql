CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"agent" text NOT NULL,
	"details" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"state" text,
	"nonce" text,
	"code_verifier" text,
	"human_subject" text,
	"acr" text,
	"auth_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "approvals_state_unique" UNIQUE("state")
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "human_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "human_subject" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "approval_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_one_per_human_idx" ON "reviews" USING btree ("human_subject","agent_id","task") WHERE "reviews"."human_verified";