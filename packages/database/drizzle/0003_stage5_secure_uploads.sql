DO $stage5_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."documents" LIMIT 1) THEN
    RAISE EXCEPTION 'Stage 5 secure upload migration refused: documents must be empty';
  END IF;
END
$stage5_preflight$;--> statement-breakpoint
CREATE TYPE "public"."document_scan_job_status" AS ENUM('pending', 'processing', 'retry', 'completed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."upload_session_status" AS ENUM('initialized', 'uploading', 'uploaded', 'completed', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "document_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"audience" varchar(64) DEFAULT 'craft72_employee' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_access_grants_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "document_access_grants_token_hash_format" CHECK ("document_access_grants"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_access_grants_audience_format" CHECK ("document_access_grants"."audience" ~ '^[a-z][a-z0-9._:-]{2,63}$'),
	CONSTRAINT "document_access_grants_expiry_after_creation" CHECK ("document_access_grants"."expires_at" > "document_access_grants"."created_at"),
	CONSTRAINT "document_access_grants_revocation_after_creation" CHECK ("document_access_grants"."revoked_at" is null or "document_access_grants"."revoked_at" >= "document_access_grants"."created_at"),
	CONSTRAINT "document_access_grants_access_after_creation" CHECK ("document_access_grants"."last_accessed_at" is null or "document_access_grants"."last_accessed_at" >= "document_access_grants"."created_at"),
	CONSTRAINT "document_access_grants_access_count_nonnegative" CHECK ("document_access_grants"."access_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_scan_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "document_scan_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "document_scan_jobs_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "document_scan_jobs_attempts_nonnegative" CHECK ("document_scan_jobs"."attempts" >= 0),
	CONSTRAINT "document_scan_jobs_lease_matches_status" CHECK (("document_scan_jobs"."status" = 'processing'
          and "document_scan_jobs"."lease_token" is not null and "document_scan_jobs"."lease_expires_at" is not null)
        or ("document_scan_jobs"."status" <> 'processing'
          and "document_scan_jobs"."lease_token" is null and "document_scan_jobs"."lease_expires_at" is null)),
	CONSTRAINT "document_scan_jobs_finished_at_matches_status" CHECK (("document_scan_jobs"."status" in ('completed', 'dead_letter') and "document_scan_jobs"."finished_at" is not null)
        or ("document_scan_jobs"."status" not in ('completed', 'dead_letter') and "document_scan_jobs"."finished_at" is null))
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"max_user_id" bigint NOT NULL,
	"capability_hash" varchar(64) NOT NULL,
	"original_name" text NOT NULL,
	"declared_mime_type" varchar(255) NOT NULL,
	"expected_size_bytes" bigint NOT NULL,
	"expected_sha256" varchar(64),
	"received_size_bytes" bigint,
	"received_sha256" varchar(64),
	"detected_mime_type" varchar(255),
	"detected_file_type" varchar(64),
	"quarantine_storage_key" text NOT NULL,
	"status" "upload_session_status" DEFAULT 'initialized' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" varchar(128),
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "upload_sessions_capability_hash_unique" UNIQUE("capability_hash"),
	CONSTRAINT "upload_sessions_quarantine_storage_key_unique" UNIQUE("quarantine_storage_key"),
	CONSTRAINT "upload_sessions_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "upload_sessions_capability_hash_format" CHECK ("upload_sessions"."capability_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "upload_sessions_original_name_safe" CHECK (char_length(btrim("upload_sessions"."original_name")) > 0
        and position('/' in "upload_sessions"."original_name") = 0
        and position(chr(92) in "upload_sessions"."original_name") = 0),
	CONSTRAINT "upload_sessions_quarantine_storage_key_safe" CHECK (char_length(btrim("upload_sessions"."quarantine_storage_key")) > 0
        and left("upload_sessions"."quarantine_storage_key", 1) <> '/'
        and position('..' in "upload_sessions"."quarantine_storage_key") = 0
        and position(chr(92) in "upload_sessions"."quarantine_storage_key") = 0),
	CONSTRAINT "upload_sessions_declared_mime_type_not_blank" CHECK (char_length(btrim("upload_sessions"."declared_mime_type")) > 0),
	CONSTRAINT "upload_sessions_expected_size_positive" CHECK ("upload_sessions"."expected_size_bytes" > 0),
	CONSTRAINT "upload_sessions_expected_sha256_format" CHECK ("upload_sessions"."expected_sha256" is null or "upload_sessions"."expected_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "upload_sessions_received_metadata_consistent" CHECK (num_nonnulls("upload_sessions"."received_size_bytes", "upload_sessions"."received_sha256",
          "upload_sessions"."detected_mime_type", "upload_sessions"."detected_file_type") = 0
        or (num_nonnulls("upload_sessions"."received_size_bytes", "upload_sessions"."received_sha256",
            "upload_sessions"."detected_mime_type", "upload_sessions"."detected_file_type") = 4
          and "upload_sessions"."received_size_bytes" > 0
          and "upload_sessions"."received_sha256" ~ '^[0-9a-f]{64}$'
          and char_length(btrim("upload_sessions"."detected_mime_type")) > 0
          and char_length(btrim("upload_sessions"."detected_file_type")) > 0)),
	CONSTRAINT "upload_sessions_attempts_nonnegative" CHECK ("upload_sessions"."attempts" >= 0),
	CONSTRAINT "upload_sessions_lease_matches_status" CHECK (("upload_sessions"."status" = 'uploading'
          and "upload_sessions"."lease_token" is not null and "upload_sessions"."lease_expires_at" is not null)
        or ("upload_sessions"."status" <> 'uploading'
          and "upload_sessions"."lease_token" is null and "upload_sessions"."lease_expires_at" is null)),
	CONSTRAINT "upload_sessions_uploaded_metadata_matches_status" CHECK ("upload_sessions"."status" not in ('uploaded', 'completed')
        or ("upload_sessions"."received_size_bytes" is not null and "upload_sessions"."uploaded_at" is not null)),
	CONSTRAINT "upload_sessions_document_matches_status" CHECK (("upload_sessions"."status" = 'completed'
          and "upload_sessions"."document_id" is not null and "upload_sessions"."completed_at" is not null)
        or ("upload_sessions"."status" <> 'completed'
          and "upload_sessions"."document_id" is null and "upload_sessions"."completed_at" is null)),
	CONSTRAINT "upload_sessions_expiry_after_creation" CHECK ("upload_sessions"."expires_at" > "upload_sessions"."created_at"),
	CONSTRAINT "upload_sessions_upload_after_creation" CHECK ("upload_sessions"."uploaded_at" is null or "upload_sessions"."uploaded_at" >= "upload_sessions"."created_at"),
	CONSTRAINT "upload_sessions_completion_after_upload" CHECK ("upload_sessions"."completed_at" is null or "upload_sessions"."completed_at" >= "upload_sessions"."uploaded_at")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "detected_mime_type" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "detected_file_type" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "scan_engine" varchar(64);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "scan_engine_version" varchar(128);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "scan_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "available_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "document_scan_jobs" ADD CONSTRAINT "document_scan_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_max_user_id_max_users_max_user_id_fk" FOREIGN KEY ("max_user_id") REFERENCES "public"."max_users"("max_user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_id_user_unique" UNIQUE("id","max_user_id");--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_document_owner_fk" FOREIGN KEY ("document_id","max_user_id") REFERENCES "public"."documents"("id","max_user_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "document_access_grants_document_idx" ON "document_access_grants" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_access_grants_active_expiry_idx" ON "document_access_grants" USING btree ("expires_at") WHERE "document_access_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "document_scan_jobs_ready_idx" ON "document_scan_jobs" USING btree ("status","next_attempt_at","created_at") WHERE "document_scan_jobs"."status" in ('pending', 'retry');--> statement-breakpoint
CREATE INDEX "upload_sessions_owner_status_expiry_idx" ON "upload_sessions" USING btree ("max_user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "upload_sessions_expiry_idx" ON "upload_sessions" USING btree ("expires_at") WHERE "upload_sessions"."status" not in ('completed', 'expired');--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_detected_mime_type_not_blank" CHECK (char_length(btrim("documents"."detected_mime_type")) > 0);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_detected_file_type_not_blank" CHECK (char_length(btrim("documents"."detected_file_type")) > 0);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_upload_after_creation" CHECK ("documents"."uploaded_at" >= "documents"."created_at");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_scan_metadata_not_blank" CHECK (("documents"."scan_engine" is null or char_length(btrim("documents"."scan_engine")) > 0)
        and ("documents"."scan_engine_version" is null or char_length(btrim("documents"."scan_engine_version")) > 0));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_scan_timestamps_match_status" CHECK (("documents"."scan_status" in ('pending', 'scanning')
          and "documents"."scan_completed_at" is null and "documents"."available_at" is null)
        or ("documents"."scan_status" = 'clean'
          and "documents"."scan_completed_at" is not null and "documents"."available_at" is not null)
        or ("documents"."scan_status" in ('infected', 'failed')
          and "documents"."scan_completed_at" is not null and "documents"."available_at" is null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_availability_after_scan" CHECK ("documents"."available_at" is null or "documents"."available_at" >= "documents"."scan_completed_at");
