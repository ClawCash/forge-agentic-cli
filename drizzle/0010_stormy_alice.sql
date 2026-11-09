CREATE TABLE "pending_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_reviews" ADD COLUMN "task_description" text;--> statement-breakpoint
ALTER TABLE "api_reviews" ADD COLUMN "output_hash" text;--> statement-breakpoint
ALTER TABLE "api_reviews" ADD COLUMN "output_status" integer;--> statement-breakpoint
ALTER TABLE "api_reviews" ADD COLUMN "output_type" text;--> statement-breakpoint
ALTER TABLE "api_reviews" ADD COLUMN "output_bytes" integer;--> statement-breakpoint
ALTER TABLE "api_reviews" ADD COLUMN "output_shape" jsonb;--> statement-breakpoint
ALTER TABLE "api_reviews" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "pending_reviews" ADD CONSTRAINT "pending_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;