-- Development/test rollback only. This removes Stage 3 authentication and
-- idempotency metadata and must not be used as a routine production rollback.
BEGIN;

DO $rollback$
DECLARE
  initial_count integer;
  target_count integer;
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'Stage 3 rollback refused: Drizzle migration ledger is missing';
  END IF;

  SELECT count(*)
    INTO initial_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784103416945
     AND "hash" = '36a604948a3f6e6a55b20e9d8f41754324eef9be129dc63c5c826f29f4835133';

  IF initial_count <> 1 THEN
    RAISE EXCEPTION 'Stage 3 rollback refused: initial migration ledger entry is missing or invalid';
  END IF;

  SELECT count(*)
    INTO target_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784108206383
     AND "hash" = '17aee77e8f495cdd96ed9127e8d8ea61bf6581bb6790de6f0dbee86bef339999';

  IF target_count <> 1 THEN
    RAISE EXCEPTION 'Stage 3 rollback refused: target migration ledger entry is missing or invalid';
  END IF;

  IF (SELECT count(*) FROM "drizzle"."__drizzle_migrations") <> 2 THEN
    RAISE EXCEPTION 'Stage 3 rollback refused: unexpected migration ledger entries exist';
  END IF;
END
$rollback$;

ALTER TABLE "public"."sessions"
  DROP CONSTRAINT "sessions_token_hash_unique",
  DROP CONSTRAINT "sessions_token_hash_format",
  DROP CONSTRAINT "sessions_start_param_not_blank",
  DROP CONSTRAINT "sessions_consent_version_format",
  DROP CONSTRAINT "sessions_consent_text_hash_format",
  DROP CONSTRAINT "sessions_terms_version_format",
  DROP CONSTRAINT "sessions_terms_text_hash_format";

ALTER TABLE "public"."submissions"
  DROP CONSTRAINT "submissions_request_hash_format",
  DROP CONSTRAINT "submissions_consent_text_hash_format",
  DROP CONSTRAINT "submissions_terms_version_format",
  DROP CONSTRAINT "submissions_terms_text_hash_format";

ALTER TABLE "public"."lead_drafts"
  DROP CONSTRAINT "lead_drafts_consent_version_format",
  DROP CONSTRAINT "lead_drafts_consent_text_hash_format",
  DROP CONSTRAINT "lead_drafts_terms_version_format",
  DROP CONSTRAINT "lead_drafts_terms_text_hash_format";

ALTER TABLE "public"."sessions"
  DROP COLUMN "token_hash",
  DROP COLUMN "start_param",
  DROP COLUMN "consent_version",
  DROP COLUMN "consent_text_hash",
  DROP COLUMN "consent_client_accepted_at",
  DROP COLUMN "consented_at",
  DROP COLUMN "terms_version",
  DROP COLUMN "terms_text_hash",
  DROP COLUMN "terms_client_accepted_at",
  DROP COLUMN "terms_accepted_at";

ALTER TABLE "public"."submissions"
  DROP COLUMN "request_hash",
  DROP COLUMN "consent_text_hash",
  DROP COLUMN "terms_version",
  DROP COLUMN "terms_text_hash",
  DROP COLUMN "terms_accepted_at";

ALTER TABLE "public"."lead_drafts"
  DROP COLUMN "consent_version",
  DROP COLUMN "consent_text_hash",
  DROP COLUMN "consented_at",
  DROP COLUMN "terms_version",
  DROP COLUMN "terms_text_hash",
  DROP COLUMN "terms_accepted_at";

DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "created_at" = 1784108206383
   AND "hash" = '17aee77e8f495cdd96ed9127e8d8ea61bf6581bb6790de6f0dbee86bef339999';

COMMIT;
