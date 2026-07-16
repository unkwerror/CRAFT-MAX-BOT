-- Development/test rollback only. This removes Stage 6 Tracker dependency,
-- result and claim-fencing metadata and must not be used routinely in production.
BEGIN;

DO $rollback$
DECLARE
  initial_count integer;
  runtime_count integer;
  bot_count integer;
  uploads_count integer;
  target_count integer;
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'Stage 6 Tracker outbox rollback refused: Drizzle migration ledger is missing';
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

  SELECT count(*) INTO uploads_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784176119001
     AND "hash" = '048bfdd905745d0c75a40abb64858997d6d70ba237eba98dae4b3179285e1aff';

  SELECT count(*) INTO target_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784176213204
     AND "hash" = '25083a653a2fe3ca18596d3008dc99ec25af2ddc6f31c767cd256e0ca9f1d152';

  IF initial_count <> 1 OR runtime_count <> 1 OR bot_count <> 1 OR
     uploads_count <> 1 OR target_count <> 1 THEN
    RAISE EXCEPTION 'Stage 6 Tracker outbox rollback refused: migration ledger is missing or invalid';
  END IF;

  IF (SELECT count(*) FROM "drizzle"."__drizzle_migrations") <> 5 THEN
    RAISE EXCEPTION 'Stage 6 Tracker outbox rollback refused: unexpected migration ledger entries exist';
  END IF;
END
$rollback$;

ALTER TABLE "public"."integration_outbox" DROP CONSTRAINT "integration_outbox_dependency_fk";
ALTER TABLE "public"."integration_outbox" DROP CONSTRAINT "integration_outbox_dependency_matches_operation";
ALTER TABLE "public"."integration_outbox" DROP CONSTRAINT "integration_outbox_lease_matches_status";
ALTER TABLE "public"."integration_outbox" DROP CONSTRAINT "integration_outbox_result_key_matches_status";
ALTER TABLE "public"."integration_outbox" DROP CONSTRAINT "integration_outbox_last_error_consistent";

ALTER TABLE "public"."integration_outbox" DROP COLUMN "depends_on_operation";
ALTER TABLE "public"."integration_outbox" DROP COLUMN "lease_token";
ALTER TABLE "public"."integration_outbox" DROP COLUMN "lease_expires_at";
ALTER TABLE "public"."integration_outbox" DROP COLUMN "result_key";
ALTER TABLE "public"."integration_outbox" DROP COLUMN "last_error_at";

DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "created_at" = 1784176213204
   AND "hash" = '25083a653a2fe3ca18596d3008dc99ec25af2ddc6f31c767cd256e0ca9f1d152';

COMMIT;
