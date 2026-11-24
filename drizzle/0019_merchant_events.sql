CREATE TABLE "merchant_events" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"domain" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "merchant_events_created_idx" ON "merchant_events" USING btree ("created_at");