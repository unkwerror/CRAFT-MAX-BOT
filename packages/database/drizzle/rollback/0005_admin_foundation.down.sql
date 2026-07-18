-- Development/test rollback only. This removes all admin sessions, audit history,
-- managed cases/content and review metadata. It refuses to discard non-default data.
BEGIN;

DO $rollback$
DECLARE
  initial_count integer;
  runtime_count integer;
  bot_count integer;
  uploads_count integer;
  tracker_count integer;
  target_count integer;
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'Admin foundation rollback refused: Drizzle migration ledger is missing';
  END IF;

  SELECT count(*) INTO initial_count FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784103416945
     AND "hash" = '36a604948a3f6e6a55b20e9d8f41754324eef9be129dc63c5c826f29f4835133';
  SELECT count(*) INTO runtime_count FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784108206383
     AND "hash" = '17aee77e8f495cdd96ed9127e8d8ea61bf6581bb6790de6f0dbee86bef339999';
  SELECT count(*) INTO bot_count FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784168006516
     AND "hash" = '335d8f3925c345a09a5195d255beb326a3b7b8f61a0485608bf370a7c2f713b8';
  SELECT count(*) INTO uploads_count FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784176119001
     AND "hash" = '048bfdd905745d0c75a40abb64858997d6d70ba237eba98dae4b3179285e1aff';
  SELECT count(*) INTO tracker_count FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784176213204
     AND "hash" = '25083a653a2fe3ca18596d3008dc99ec25af2ddc6f31c767cd256e0ca9f1d152';
  SELECT count(*) INTO target_count FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784349505590
     AND "hash" = '759b3c568eeacd50750b6fbe88e19c228bfb92415a765b6707bc2897b2c14be8';

  IF initial_count <> 1 OR runtime_count <> 1 OR bot_count <> 1 OR uploads_count <> 1 OR
     tracker_count <> 1 OR target_count <> 1 THEN
    RAISE EXCEPTION 'Admin foundation rollback refused: migration ledger is missing or invalid';
  END IF;

  IF (SELECT count(*) FROM "drizzle"."__drizzle_migrations") <> 6 THEN
    RAISE EXCEPTION 'Admin foundation rollback refused: unexpected migration ledger entries exist';
  END IF;

  IF EXISTS (SELECT 1 FROM "public"."admin_sessions") OR
     EXISTS (SELECT 1 FROM "public"."admin_audit_log") OR
     EXISTS (SELECT 1 FROM "public"."case_catalog_items") OR
     EXISTS (SELECT 1 FROM "public"."content_documents") OR
     EXISTS (
       SELECT 1 FROM "public"."submissions"
        WHERE "review_status" <> 'new' OR "admin_note" IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Admin foundation rollback refused: admin-managed data exists';
  END IF;
END
$rollback$;

DROP TABLE "public"."admin_audit_log";
DROP TABLE "public"."admin_sessions";
DROP TABLE "public"."case_catalog_items";
DROP TABLE "public"."content_documents";
ALTER TABLE "public"."submissions" DROP COLUMN "review_status";
ALTER TABLE "public"."submissions" DROP COLUMN "admin_note";
DROP TYPE "public"."submission_review_status";
DROP TYPE "public"."content_document_kind";

DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "created_at" = 1784349505590
   AND "hash" = '759b3c568eeacd50750b6fbe88e19c228bfb92415a765b6707bc2897b2c14be8';

COMMIT;
