-- Development/test rollback only. It removes only untouched rows inserted by the
-- catalog seed and leaves pre-existing rows that won the ON CONFLICT untouched.
BEGIN;

DO $rollback$
DECLARE
  initial_count integer;
  runtime_count integer;
  bot_count integer;
  uploads_count integer;
  tracker_count integer;
  admin_count integer;
  target_count integer;
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
    RAISE EXCEPTION 'Case catalog seed rollback refused: Drizzle migration ledger is missing';
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
  SELECT count(*) INTO admin_count FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784349505590
     AND "hash" = '759b3c568eeacd50750b6fbe88e19c228bfb92415a765b6707bc2897b2c14be8';
  SELECT count(*) INTO target_count FROM "drizzle"."__drizzle_migrations"
   WHERE "created_at" = 1784351616909
     AND "hash" = '0cb17b2f4aa3680111b269d412798869924a26ac98504a49994545f53898707c';

  IF initial_count <> 1 OR runtime_count <> 1 OR bot_count <> 1 OR uploads_count <> 1 OR
     tracker_count <> 1 OR admin_count <> 1 OR target_count <> 1 THEN
    RAISE EXCEPTION 'Case catalog seed rollback refused: migration ledger is missing or invalid';
  END IF;

  IF (SELECT count(*) FROM "drizzle"."__drizzle_migrations") <> 7 THEN
    RAISE EXCEPTION 'Case catalog seed rollback refused: unexpected migration ledger entries exist';
  END IF;
END
$rollback$;

DELETE FROM "public"."case_catalog_items"
 WHERE "id" = ANY(ARRAY[
   'businesshouse',
   'sportscentertsimlyanskoe',
   'childcenter',
   'citypumpingstation',
   'gagarinsky',
   'zemstvoschool',
   'industrialpark',
   'masterplan'
 ]::text[])
   AND "version" = 1
   AND "created_at" = timestamptz '2026-07-18 05:13:36.909+00'
   AND "updated_at" = timestamptz '2026-07-18 05:13:36.909+00';

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "public"."case_catalog_items"
     WHERE "id" = ANY(ARRAY[
       'businesshouse',
       'sportscentertsimlyanskoe',
       'childcenter',
       'citypumpingstation',
       'gagarinsky',
       'zemstvoschool',
       'industrialpark',
       'masterplan'
     ]::text[])
       AND "created_at" = timestamptz '2026-07-18 05:13:36.909+00'
  ) THEN
    RAISE EXCEPTION 'Case catalog seed rollback refused: seeded cases contain admin-managed changes';
  END IF;
END
$rollback$;

DELETE FROM "drizzle"."__drizzle_migrations"
 WHERE "created_at" = 1784351616909
   AND "hash" = '0cb17b2f4aa3680111b269d412798869924a26ac98504a49994545f53898707c';

COMMIT;
