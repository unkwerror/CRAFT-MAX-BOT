CREATE TYPE "public"."customer_role" AS ENUM('developer', 'investor', 'government_customer', 'property_owner', 'general_contractor', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_scan_status" AS ENUM('pending', 'scanning', 'clean', 'infected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."integration_operation" AS ENUM('upsert_partner', 'create_crm', 'create_docs');--> statement-breakpoint
CREATE TYPE "public"."integration_outbox_status" AS ENUM('pending', 'processing', 'retry', 'completed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."project_scope" AS ENUM('single_object', 'portfolio');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('received', 'syncing', 'synced', 'sync_failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."webhook_inbox_status" AS ENUM('pending', 'processing', 'retry', 'processed', 'dead_letter');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid,
	"max_user_id" bigint NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"scan_status" "document_scan_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staged_expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "documents_submission_sha256_unique" UNIQUE("submission_id","sha256"),
	CONSTRAINT "documents_original_name_safe" CHECK (char_length(btrim("documents"."original_name")) > 0
        and position('/' in "documents"."original_name") = 0
        and position(chr(92) in "documents"."original_name") = 0),
	CONSTRAINT "documents_storage_key_safe" CHECK (char_length(btrim("documents"."storage_key")) > 0
        and left("documents"."storage_key", 1) <> '/'
        and position('..' in "documents"."storage_key") = 0
        and position(chr(92) in "documents"."storage_key") = 0),
	CONSTRAINT "documents_mime_type_not_blank" CHECK (char_length(btrim("documents"."mime_type")) > 0),
	CONSTRAINT "documents_size_positive" CHECK ("documents"."size_bytes" > 0),
	CONSTRAINT "documents_sha256_format" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documents_deletion_after_creation" CHECK ("documents"."deleted_at" is null or "documents"."deleted_at" >= "documents"."created_at"),
	CONSTRAINT "documents_staged_expiry_after_creation" CHECK ("documents"."submission_id" is not null or "documents"."staged_expires_at" > "documents"."created_at")
);
--> statement-breakpoint
CREATE TABLE "integration_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"operation" "integration_operation" NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "integration_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "integration_outbox_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "integration_outbox_submission_operation_unique" UNIQUE("submission_id","operation"),
	CONSTRAINT "integration_outbox_idempotency_key_not_blank" CHECK (char_length(btrim("integration_outbox"."idempotency_key")) > 0),
	CONSTRAINT "integration_outbox_attempts_nonnegative" CHECK ("integration_outbox"."attempts" >= 0),
	CONSTRAINT "integration_outbox_completed_at_matches_status" CHECK (("integration_outbox"."status" = 'completed' and "integration_outbox"."completed_at" is not null)
        or ("integration_outbox"."status" <> 'completed' and "integration_outbox"."completed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "lead_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"max_user_id" bigint NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" varchar(128) DEFAULT 'direct' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lead_drafts_max_user_id_unique" UNIQUE("max_user_id"),
	CONSTRAINT "lead_drafts_current_step_range" CHECK ("lead_drafts"."current_step" between 1 and 17),
	CONSTRAINT "lead_drafts_source_not_blank" CHECK (char_length(btrim("lead_drafts"."source")) > 0),
	CONSTRAINT "lead_drafts_expiry_after_creation" CHECK ("lead_drafts"."expires_at" > "lead_drafts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "max_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"max_user_id" bigint NOT NULL,
	"first_name" varchar(255) NOT NULL,
	"last_name" varchar(255),
	"username" varchar(255),
	"language_code" varchar(35),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "max_users_max_user_id_unique" UNIQUE("max_user_id"),
	CONSTRAINT "max_users_max_user_id_positive" CHECK ("max_users"."max_user_id" > 0),
	CONSTRAINT "max_users_first_name_not_blank" CHECK (char_length(btrim("max_users"."first_name")) > 0),
	CONSTRAINT "max_users_optional_names_not_blank" CHECK (("max_users"."last_name" is null or char_length(btrim("max_users"."last_name")) > 0)
        and ("max_users"."username" is null or char_length(btrim("max_users"."username")) > 0))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"max_user_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_expiry_after_creation" CHECK ("sessions"."expires_at" > "sessions"."created_at"),
	CONSTRAINT "sessions_revocation_after_creation" CHECK ("sessions"."revoked_at" is null or "sessions"."revoked_at" >= "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"max_user_id" bigint NOT NULL,
	"customer_role" "customer_role" NOT NULL,
	"contact_name" varchar(255) NOT NULL,
	"organization" varchar(255),
	"inn" varchar(12),
	"object_type" varchar(255) NOT NULL,
	"city" varchar(255),
	"region" varchar(255),
	"project_scope" "project_scope" NOT NULL,
	"object_count" integer DEFAULT 1 NOT NULL,
	"area_sqm" numeric(14, 2),
	"project_stage" varchar(255) NOT NULL,
	"services" text[] NOT NULL,
	"needs_expertise" boolean,
	"is_cultural_heritage" boolean,
	"desired_start" varchar(128),
	"description" text NOT NULL,
	"material_links" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"selected_case_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"phone" varchar(32) NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"email" varchar(320) NOT NULL,
	"consent_version" varchar(64) NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"source" varchar(128) DEFAULT 'direct' NOT NULL,
	"status" "submission_status" DEFAULT 'received' NOT NULL,
	"tracker_crm_key" varchar(64),
	"tracker_part_key" varchar(64),
	"tracker_docs_key" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_submission_id_unique" UNIQUE("submission_id"),
	CONSTRAINT "submissions_id_user_unique" UNIQUE("id","max_user_id"),
	CONSTRAINT "submissions_user_idempotency_key_unique" UNIQUE("max_user_id","idempotency_key"),
	CONSTRAINT "submissions_submission_id_format" CHECK ("submissions"."submission_id" ~ '^[A-Z0-9][A-Z0-9-]{5,63}$'),
	CONSTRAINT "submissions_idempotency_key_format" CHECK ("submissions"."idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
	CONSTRAINT "submissions_contact_name_not_blank" CHECK (char_length(btrim("submissions"."contact_name")) > 0),
	CONSTRAINT "submissions_location_present" CHECK (("submissions"."city" is null or char_length(btrim("submissions"."city")) > 0)
        and ("submissions"."region" is null or char_length(btrim("submissions"."region")) > 0)
        and ("submissions"."city" is not null or "submissions"."region" is not null)),
	CONSTRAINT "submissions_inn_format" CHECK ("submissions"."inn" is null or "submissions"."inn" ~ '^[0-9]{10}([0-9]{2})?$'),
	CONSTRAINT "submissions_object_count_valid" CHECK ("submissions"."object_count" >= 1
        and ("submissions"."project_scope" <> 'single_object' or "submissions"."object_count" = 1)),
	CONSTRAINT "submissions_area_positive" CHECK ("submissions"."area_sqm" is null or "submissions"."area_sqm" > 0),
	CONSTRAINT "submissions_services_not_empty" CHECK (cardinality("submissions"."services") > 0),
	CONSTRAINT "submissions_selected_cases_limit" CHECK (cardinality("submissions"."selected_case_ids") <= 10),
	CONSTRAINT "submissions_description_not_blank" CHECK (char_length(btrim("submissions"."description")) > 0),
	CONSTRAINT "submissions_phone_not_blank" CHECK (char_length(btrim("submissions"."phone")) > 0),
	CONSTRAINT "submissions_email_not_blank" CHECK (char_length(btrim("submissions"."email")) > 0),
	CONSTRAINT "submissions_consent_version_not_blank" CHECK (char_length(btrim("submissions"."consent_version")) > 0),
	CONSTRAINT "submissions_source_not_blank" CHECK (char_length(btrim("submissions"."source")) > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"event_key" varchar(255) PRIMARY KEY NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"chat_id" bigint,
	"payload" jsonb NOT NULL,
	"status" "webhook_inbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" varchar(128),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_inbox_event_key_not_blank" CHECK (char_length(btrim("webhook_inbox"."event_key")) > 0),
	CONSTRAINT "webhook_inbox_event_type_not_blank" CHECK (char_length(btrim("webhook_inbox"."event_type")) > 0),
	CONSTRAINT "webhook_inbox_attempts_nonnegative" CHECK ("webhook_inbox"."attempts" >= 0),
	CONSTRAINT "webhook_inbox_processed_at_matches_status" CHECK (("webhook_inbox"."status" = 'processed' and "webhook_inbox"."processed_at" is not null)
        or ("webhook_inbox"."status" <> 'processed' and "webhook_inbox"."processed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_max_user_id_max_users_max_user_id_fk" FOREIGN KEY ("max_user_id") REFERENCES "public"."max_users"("max_user_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_submission_owner_fk" FOREIGN KEY ("submission_id","max_user_id") REFERENCES "public"."submissions"("id","max_user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_drafts" ADD CONSTRAINT "lead_drafts_max_user_id_max_users_max_user_id_fk" FOREIGN KEY ("max_user_id") REFERENCES "public"."max_users"("max_user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_max_user_id_max_users_max_user_id_fk" FOREIGN KEY ("max_user_id") REFERENCES "public"."max_users"("max_user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_max_user_id_max_users_max_user_id_fk" FOREIGN KEY ("max_user_id") REFERENCES "public"."max_users"("max_user_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_staged_user_sha256_uidx" ON "documents" USING btree ("max_user_id","sha256") WHERE "documents"."submission_id" is null and "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_active_submission_idx" ON "documents" USING btree ("submission_id","created_at") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_pending_scan_idx" ON "documents" USING btree ("scan_status","created_at") WHERE "documents"."scan_status" in ('pending', 'scanning');--> statement-breakpoint
CREATE INDEX "documents_staged_expiry_idx" ON "documents" USING btree ("staged_expires_at") WHERE "documents"."submission_id" is null and "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "integration_outbox_ready_idx" ON "integration_outbox" USING btree ("status","next_attempt_at","created_at") WHERE "integration_outbox"."status" in ('pending', 'retry');--> statement-breakpoint
CREATE INDEX "integration_outbox_submission_idx" ON "integration_outbox" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "lead_drafts_expires_at_idx" ON "lead_drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_active_user_expiry_idx" ON "sessions" USING btree ("max_user_id","expires_at") WHERE "sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "submissions_user_created_at_idx" ON "submissions" USING btree ("max_user_id","created_at");--> statement-breakpoint
CREATE INDEX "submissions_pending_sync_idx" ON "submissions" USING btree ("status","created_at") WHERE "submissions"."status" in ('received', 'syncing', 'sync_failed');--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_tracker_crm_key_uidx" ON "submissions" USING btree ("tracker_crm_key") WHERE "submissions"."tracker_crm_key" is not null;--> statement-breakpoint
CREATE INDEX "submissions_tracker_part_key_idx" ON "submissions" USING btree ("tracker_part_key") WHERE "submissions"."tracker_part_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_tracker_docs_key_uidx" ON "submissions" USING btree ("tracker_docs_key") WHERE "submissions"."tracker_docs_key" is not null;--> statement-breakpoint
CREATE INDEX "webhook_inbox_ready_idx" ON "webhook_inbox" USING btree ("status","next_attempt_at","received_at") WHERE "webhook_inbox"."status" in ('pending', 'retry');--> statement-breakpoint
CREATE INDEX "webhook_inbox_chat_order_idx" ON "webhook_inbox" USING btree ("chat_id","received_at");