DROP INDEX "reviews_one_per_human_idx";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "human_repeat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_one_per_human_idx" ON "reviews" USING btree ("human_subject","agent_id","task") WHERE "reviews"."human_verified" and not "reviews"."human_repeat";