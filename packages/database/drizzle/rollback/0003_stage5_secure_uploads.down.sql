-- Development/test rollback only. This removes Stage 5 upload, scan and
-- signed-access state and must not be used as a routine production rollback.
BEGIN;

DO $rollback$
DECLARE
  initial_count integer;
  runtime_count integer;
  bot_count integer;
  target_count integer;
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'Stage 5 secure uploads rollback refused: Drizzle migration ledger is missing';
  END IF;

  SELECT count(*) INTO initial_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784103416945
     AND "hash" = '36a604948a3f6e6a55b20e9d8f41754324eef9be129dc63c5c826f29f4835133';

  SELECT count(*) INTO runtime_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784108206383
     AND "hash" = '17aee77e8f495cdd96ed9127e8d8ea61bf6581bb6790de6f0dbee86bef339999';

  SELECT count(*) INTO bot_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784168006516
     AND "hash" = '335d8f3925c345a09a5195d255beb326a3b7b8f61a0485608bf370a7c2f713b8';

  SELECT count(*) INTO target_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784176119001
     AND "hash" = '048bfdd905745d0c75a40abb64858997d6d70ba237eba98dae4b3179285e1aff';

  IF initial_count <> 1 OR runtime_count <> 1 OR bot_count <> 1 OR target_count <> 1 THEN
    RAISE EXCEPTION 'Stage 5 secure uploads rollback refused: migration ledger is missing or invalid';
  END IF;

  IF (SELECT count(*) FROM "drizzle"."__drizzle_migrations") <> 4 THEN
    RAISE EXCEPTION 'Stage 5 secure uploads rollback refused: unexpected migration ledger entries exist';
  END IF;
END
$rollback$;

DROP TABLE "public"."document_access_grants";
DROP TABLE "public"."document_scan_jobs";
DROP TABLE "public"."upload_sessions";

ALTER TABLE "public"."documents" DROP CONSTRAINT "documents_id_user_unique";
ALTER TABLE "public"."documents" DROP CONSTRAINT "documents_detected_mime_type_not_blank";
ALTER TABLE "public"."documents" DROP CONSTRAINT "documents_detected_file_type_not_blank";
ALTER TABLE "public"."documents" DROP CONSTRAINT "documents_upload_after_creation";
ALTER TABLE "public"."documents" DROP CONSTRAINT "documents_scan_metadata_not_blank";
ALTER TABLE "public"."documents" DROP CONSTRAINT "documents_scan_timestamps_match_status";
ALTER TABLE "public"."documents" DROP CONSTRAINT "documents_availability_after_scan";

ALTER TABLE "public"."documents" DROP COLUMN "detected_mime_type";
ALTER TABLE "public"."documents" DROP COLUMN "detected_file_type";
ALTER TABLE "public"."documents" DROP COLUMN "uploaded_at";
ALTER TABLE "public"."documents" DROP COLUMN "scan_engine";
ALTER TABLE "public"."documents" DROP COLUMN "scan_engine_version";
ALTER TABLE "public"."documents" DROP COLUMN "scan_completed_at";
ALTER TABLE "public"."documents" DROP COLUMN "available_at";

DROP TYPE "public"."document_scan_job_status";
DROP TYPE "public"."upload_session_status";

DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "created_at" = 1784176119001
   AND "hash" = '048bfdd905745d0c75a40abb64858997d6d70ba237eba98dae4b3179285e1aff';

COMMIT;
