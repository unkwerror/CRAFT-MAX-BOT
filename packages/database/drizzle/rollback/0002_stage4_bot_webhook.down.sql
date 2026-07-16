-- Development/test rollback only. This removes durable Stage 4 bot state and
-- must not be used as a routine production rollback.
BEGIN;

DO $rollback$
DECLARE
  initial_count integer;
  runtime_count integer;
  target_count integer;
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'Stage 4 bot rollback refused: Drizzle migration ledger is missing';
  END IF;

  SELECT count(*)
    INTO initial_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784103416945
     AND "hash" = '36a604948a3f6e6a55b20e9d8f41754324eef9be129dc63c5c826f29f4835133';

  IF initial_count <> 1 THEN
    RAISE EXCEPTION 'Stage 4 bot rollback refused: initial migration ledger entry is missing or invalid';
  END IF;

  SELECT count(*)
    INTO runtime_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784108206383
     AND "hash" = '17aee77e8f495cdd96ed9127e8d8ea61bf6581bb6790de6f0dbee86bef339999';

  IF runtime_count <> 1 THEN
    RAISE EXCEPTION 'Stage 4 bot rollback refused: Stage 3 migration ledger entry is missing or invalid';
  END IF;

  SELECT count(*)
    INTO target_count
    FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784168006516
     AND "hash" = '335d8f3925c345a09a5195d255beb326a3b7b8f61a0485608bf370a7c2f713b8';

  IF target_count <> 1 THEN
    RAISE EXCEPTION 'Stage 4 bot rollback refused: target migration ledger entry is missing or invalid';
  END IF;

  IF (SELECT count(*) FROM "drizzle"."__drizzle_migrations") <> 3 THEN
    RAISE EXCEPTION 'Stage 4 bot rollback refused: unexpected migration ledger entries exist';
  END IF;
END
$rollback$;

DROP TABLE "public"."max_bot_outbox";
DROP TABLE "public"."bot_inquiries";
DROP TABLE "public"."bot_dialogs";

DROP TYPE "public"."max_bot_outbox_status";
DROP TYPE "public"."max_bot_outbox_action";
DROP TYPE "public"."bot_inquiry_status";
DROP TYPE "public"."bot_dialog_status";

DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "created_at" = 1784168006516
   AND "hash" = '335d8f3925c345a09a5195d255beb326a3b7b8f61a0485608bf370a7c2f713b8';

COMMIT;
