BEGIN;

DO $rollback$
DECLARE
  target_count integer;
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'Initial rollback refused: Drizzle migration ledger is missing';
  END IF;

  SELECT count(*)
    INTO target_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784103416945
     AND "hash" = '36a604948a3f6e6a55b20e9d8f41754324eef9be129dc63c5c826f29f4835133';

  IF target_count <> 1 THEN
    RAISE EXCEPTION 'Initial rollback refused: target migration ledger entry is missing or invalid';
  END IF;

  IF (SELECT count(*) FROM "drizzle"."__drizzle_migrations") <> 1 THEN
    RAISE EXCEPTION 'Initial rollback refused: unexpected migration ledger entries exist';
  END IF;

  DELETE FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784103416945
     AND "hash" = '36a604948a3f6e6a55b20e9d8f41754324eef9be129dc63c5c826f29f4835133';
END
$rollback$;

DROP TABLE IF EXISTS "public"."integration_outbox";
DROP TABLE IF EXISTS "public"."documents";
DROP TABLE IF EXISTS "public"."webhook_inbox";
DROP TABLE IF EXISTS "public"."submissions";
DROP TABLE IF EXISTS "public"."lead_drafts";
DROP TABLE IF EXISTS "public"."sessions";
DROP TABLE IF EXISTS "public"."max_users";

DROP TYPE IF EXISTS "public"."integration_outbox_status";
DROP TYPE IF EXISTS "public"."integration_operation";
DROP TYPE IF EXISTS "public"."webhook_inbox_status";
DROP TYPE IF EXISTS "public"."submission_status";
DROP TYPE IF EXISTS "public"."project_scope";
DROP TYPE IF EXISTS "public"."document_scan_status";
DROP TYPE IF EXISTS "public"."customer_role";

COMMIT;
