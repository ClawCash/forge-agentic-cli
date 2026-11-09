ALTER TABLE "service_profiles" ADD COLUMN "site_url" text;
--> statement-breakpoint
DELETE FROM "service_profiles";
