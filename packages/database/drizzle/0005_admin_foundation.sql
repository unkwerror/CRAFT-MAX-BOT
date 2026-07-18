CREATE TYPE "public"."content_document_kind" AS ENUM('questionnaire', 'miniapp', 'bot');--> statement-breakpoint
CREATE TYPE "public"."submission_review_status" AS ENUM('new', 'in_review', 'contacted', 'qualified', 'closed', 'rejected');--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_max_user_id" bigint NOT NULL,
	"action" varchar(80) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"target_id" varchar(128) NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_log_action_not_blank" CHECK (char_length(btrim("admin_audit_log"."action")) > 0),
	CONSTRAINT "admin_audit_log_target_type_not_blank" CHECK (char_length(btrim("admin_audit_log"."target_type")) > 0),
	CONSTRAINT "admin_audit_log_target_id_not_blank" CHECK (char_length(btrim("admin_audit_log"."target_id")) > 0),
	CONSTRAINT "admin_audit_log_request_id_not_blank" CHECK (char_length(btrim("admin_audit_log"."request_id")) > 0),
	CONSTRAINT "admin_audit_log_metadata_object" CHECK (jsonb_typeof("admin_audit_log"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"max_user_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "admin_sessions_token_hash_format" CHECK ("admin_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "admin_sessions_expiry_after_creation" CHECK ("admin_sessions"."expires_at" > "admin_sessions"."created_at"),
	CONSTRAINT "admin_sessions_revocation_after_creation" CHECK ("admin_sessions"."revoked_at" is null or "admin_sessions"."revoked_at" >= "admin_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "case_catalog_items" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"title" varchar(250) NOT NULL,
	"url" text NOT NULL,
	"image" text,
	"city" varchar(200) NOT NULL,
	"region" varchar(200) NOT NULL,
	"categories" text[] NOT NULL,
	"services" text[] NOT NULL,
	"area_sqm" numeric(14, 2),
	"scale" varchar(64),
	"construction_kind" varchar(64),
	"status" varchar(80) NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_catalog_items_id_format" CHECK ("case_catalog_items"."id" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "case_catalog_items_title_not_blank" CHECK (char_length(btrim("case_catalog_items"."title")) > 0),
	CONSTRAINT "case_catalog_items_url_https" CHECK ("case_catalog_items"."url" ~ '^https://'),
	CONSTRAINT "case_catalog_items_image_https" CHECK ("case_catalog_items"."image" is null or "case_catalog_items"."image" ~ '^https://'),
	CONSTRAINT "case_catalog_items_city_not_blank" CHECK (char_length(btrim("case_catalog_items"."city")) > 0),
	CONSTRAINT "case_catalog_items_region_not_blank" CHECK (char_length(btrim("case_catalog_items"."region")) > 0),
	CONSTRAINT "case_catalog_items_categories_not_empty" CHECK (cardinality("case_catalog_items"."categories") > 0),
	CONSTRAINT "case_catalog_items_services_not_empty" CHECK (cardinality("case_catalog_items"."services") > 0),
	CONSTRAINT "case_catalog_items_area_positive" CHECK ("case_catalog_items"."area_sqm" is null or "case_catalog_items"."area_sqm" > 0),
	CONSTRAINT "case_catalog_items_status_not_blank" CHECK (char_length(btrim("case_catalog_items"."status")) > 0),
	CONSTRAINT "case_catalog_items_version_positive" CHECK ("case_catalog_items"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "content_documents" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"kind" "content_document_kind" NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"published_version" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_documents_key_format" CHECK ("content_documents"."key" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "content_documents_draft_object" CHECK (jsonb_typeof("content_documents"."draft") = 'object'),
	CONSTRAINT "content_documents_published_object" CHECK ("content_documents"."published" is null or jsonb_typeof("content_documents"."published") = 'object'),
	CONSTRAINT "content_documents_version_positive" CHECK ("content_documents"."version" > 0),
	CONSTRAINT "content_documents_published_consistent" CHECK (("content_documents"."published" is null and "content_documents"."published_version" is null and "content_documents"."published_at" is null)
        or ("content_documents"."published" is not null and "content_documents"."published_version" is not null
          and "content_documents"."published_version" > 0 and "content_documents"."published_version" <= "content_documents"."version"
          and "content_documents"."published_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "review_status" "submission_review_status" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "admin_note" text;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_max_user_id_max_users_max_user_id_fk" FOREIGN KEY ("actor_max_user_id") REFERENCES "public"."max_users"("max_user_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_max_user_id_max_users_max_user_id_fk" FOREIGN KEY ("max_user_id") REFERENCES "public"."max_users"("max_user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "admin_audit_log_actor_created_idx" ON "admin_audit_log" USING btree ("actor_max_user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_created_idx" ON "admin_audit_log" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_sessions_active_user_expiry_idx" ON "admin_sessions" USING btree ("max_user_id","expires_at") WHERE "admin_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "case_catalog_items_public_order_idx" ON "case_catalog_items" USING btree ("sort_order","id") WHERE "case_catalog_items"."published" = true;--> statement-breakpoint
CREATE INDEX "content_documents_kind_idx" ON "content_documents" USING btree ("kind","updated_at");--> statement-breakpoint
CREATE INDEX "submissions_review_queue_idx" ON "submissions" USING btree ("review_status","created_at");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_admin_note_not_blank" CHECK ("submissions"."admin_note" is null or char_length(btrim("submissions"."admin_note")) > 0);