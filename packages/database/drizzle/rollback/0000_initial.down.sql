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
   WHERE "created_at" = 1784100487498
     AND "hash" = '9b44cccfc7c35ab0c619c4d6ac60b7272886f2324fccccd676d54e50f2870114';

  IF target_count <> 1 THEN
    RAISE EXCEPTION 'Initial rollback refused: target migration ledger entry is missing or invalid';
  END IF;

  IF (SELECT count(*) FROM "drizzle"."__drizzle_migrations") <> 1 THEN
    RAISE EXCEPTION 'Initial rollback refused: unexpected migration ledger entries exist';
  END IF;

  DELETE FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784100487498
     AND "hash" = '9b44cccfc7c35ab0c619c4d6ac60b7272886f2324fccccd676d54e50f2870114';
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
