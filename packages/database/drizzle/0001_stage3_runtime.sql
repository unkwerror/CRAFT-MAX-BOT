ALTER TABLE "sessions" ADD COLUMN "token_hash" varchar(64);--> statement-breakpoint
UPDATE "sessions"
SET "token_hash" = md5("id"::text) || md5('craft72-session:' || "id"::text)
WHERE "token_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "start_param" varchar(128);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "consent_version" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "consent_text_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "consent_client_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "terms_version" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "terms_text_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "terms_client_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "sessions"
SET
  "consent_version" = 'legacy-session-without-consent',
  "consent_text_hash" = md5('legacy-consent:' || "id"::text) || md5('legacy-consent-proof:' || "id"::text),
  "consent_client_accepted_at" = "created_at",
  "consented_at" = "created_at",
  "terms_version" = 'legacy-session-without-terms',
  "terms_text_hash" = md5('legacy-terms:' || "id"::text) || md5('legacy-terms-proof:' || "id"::text),
  "terms_client_accepted_at" = "created_at",
  "terms_accepted_at" = "created_at"
WHERE "consent_version" IS NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "consent_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "consent_text_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "consent_client_accepted_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "consented_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "terms_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "terms_text_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "terms_client_accepted_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "terms_accepted_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD COLUMN "consent_version" varchar(64);--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD COLUMN "consent_text_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD COLUMN "consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD COLUMN "terms_version" varchar(64);--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD COLUMN "terms_text_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "lead_drafts"
SET
  "consent_version" = 'legacy-draft-without-consent',
  "consent_text_hash" = md5('legacy-draft-consent:' || "id"::text) || md5('legacy-draft-consent-proof:' || "id"::text),
  "consented_at" = "created_at",
  "terms_version" = 'legacy-draft-without-terms',
  "terms_text_hash" = md5('legacy-draft-terms:' || "id"::text) || md5('legacy-draft-terms-proof:' || "id"::text),
  "terms_accepted_at" = "created_at"
WHERE "consent_version" IS NULL;--> statement-breakpoint
ALTER TABLE "lead_drafts" ALTER COLUMN "consent_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_drafts" ALTER COLUMN "consent_text_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_drafts" ALTER COLUMN "consented_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_drafts" ALTER COLUMN "terms_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_drafts" ALTER COLUMN "terms_text_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_drafts" ALTER COLUMN "terms_accepted_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "request_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "consent_text_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "terms_version" varchar(64);--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "terms_text_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "submissions"
SET
  "request_hash" = md5("id"::text) || md5('craft72-request:' || "id"::text),
  "consent_text_hash" = md5('legacy-submission-consent:' || "id"::text) || md5('legacy-submission-consent-proof:' || "id"::text),
  "terms_version" = 'legacy-submission-without-terms',
  "terms_text_hash" = md5('legacy-submission-terms:' || "id"::text) || md5('legacy-submission-terms-proof:' || "id"::text),
  "terms_accepted_at" = "consented_at"
WHERE "request_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "request_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "consent_text_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "terms_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "terms_text_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "terms_accepted_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_token_hash_format" CHECK ("sessions"."token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_start_param_not_blank" CHECK ("sessions"."start_param" is null or char_length(btrim("sessions"."start_param")) > 0);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_consent_version_format" CHECK ("sessions"."consent_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_consent_text_hash_format" CHECK ("sessions"."consent_text_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_terms_version_format" CHECK ("sessions"."terms_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_terms_text_hash_format" CHECK ("sessions"."terms_text_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD CONSTRAINT "lead_drafts_consent_version_format" CHECK ("lead_drafts"."consent_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD CONSTRAINT "lead_drafts_consent_text_hash_format" CHECK ("lead_drafts"."consent_text_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD CONSTRAINT "lead_drafts_terms_version_format" CHECK ("lead_drafts"."terms_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD CONSTRAINT "lead_drafts_terms_text_hash_format" CHECK ("lead_drafts"."terms_text_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_request_hash_format" CHECK ("submissions"."request_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_consent_text_hash_format" CHECK ("submissions"."consent_text_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_terms_version_format" CHECK ("submissions"."terms_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_terms_text_hash_format" CHECK ("submissions"."terms_text_hash" ~ '^[0-9a-f]{64}$');
