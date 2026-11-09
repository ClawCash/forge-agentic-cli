CREATE TABLE "endpoint_health" (
	"url" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "endpoint_health_domain_idx" ON "endpoint_health" USING btree ("domain");