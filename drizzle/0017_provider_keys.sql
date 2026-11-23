CREATE TABLE "provider_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "provider_keys_key_hash_unique" UNIQUE("key_hash")
);
