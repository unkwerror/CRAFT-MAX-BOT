DO $stage6_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."integration_outbox" LIMIT 1) THEN
    RAISE EXCEPTION 'Stage 6 Tracker outbox migration refused: integration_outbox must be empty';
  END IF;
END
$stage6_preflight$;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "depends_on_operation" "integration_operation";--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "result_key" varchar(64);--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_dependency_fk" FOREIGN KEY ("submission_id","depends_on_operation") REFERENCES "public"."integration_outbox"("submission_id","operation") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_dependency_matches_operation" CHECK (("integration_outbox"."operation" = 'upsert_partner' and "integration_outbox"."depends_on_operation" is null)
        or ("integration_outbox"."operation" = 'create_crm'
          and "integration_outbox"."depends_on_operation" is not null
          and "integration_outbox"."depends_on_operation" = 'upsert_partner')
        or ("integration_outbox"."operation" = 'create_docs'
          and "integration_outbox"."depends_on_operation" is not null
          and "integration_outbox"."depends_on_operation" = 'create_crm'));--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_lease_matches_status" CHECK (("integration_outbox"."status" = 'processing'
          and "integration_outbox"."lease_token" is not null and "integration_outbox"."lease_expires_at" is not null)
        or ("integration_outbox"."status" <> 'processing'
          and "integration_outbox"."lease_token" is null and "integration_outbox"."lease_expires_at" is null));--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_result_key_matches_status" CHECK (("integration_outbox"."status" = 'completed'
          and "integration_outbox"."result_key" is not null and char_length(btrim("integration_outbox"."result_key")) > 0)
        or ("integration_outbox"."status" <> 'completed' and "integration_outbox"."result_key" is null));--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_last_error_consistent" CHECK (("integration_outbox"."last_error_code" is null and "integration_outbox"."last_error_at" is null)
        or ("integration_outbox"."last_error_code" is not null and char_length(btrim("integration_outbox"."last_error_code")) > 0
          and "integration_outbox"."last_error_at" is not null));
