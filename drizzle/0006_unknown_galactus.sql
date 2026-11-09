CREATE TABLE "service_profiles" (
	"domain" text PRIMARY KEY NOT NULL,
	"name" text,
	"description" text,
	"icon_type" text,
	"icon_data" text,
	"fetched_at" timestamp with time zone NOT NULL
);
