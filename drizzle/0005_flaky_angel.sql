ALTER TABLE "users" ADD COLUMN "auto_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_review_at" timestamp with time zone;