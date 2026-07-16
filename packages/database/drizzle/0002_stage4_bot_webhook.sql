CREATE TYPE "public"."bot_dialog_status" AS ENUM('active', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."bot_inquiry_status" AS ENUM('received', 'forwarded', 'closed');--> statement-breakpoint
CREATE TYPE "public"."max_bot_outbox_action" AS ENUM('send_message', 'answer_callback');--> statement-breakpoint
CREATE TYPE "public"."max_bot_outbox_status" AS ENUM('pending', 'processing', 'retry', 'completed', 'dead_letter');--> statement-breakpoint
CREATE TABLE "bot_dialogs" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"max_user_id" bigint,
	"status" "bot_dialog_status" DEFAULT 'active' NOT NULL,
	"last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_dialogs_chat_id_nonzero" CHECK ("bot_dialogs"."chat_id" <> 0),
	CONSTRAINT "bot_dialogs_max_user_id_positive" CHECK ("bot_dialogs"."max_user_id" is null or "bot_dialogs"."max_user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "bot_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(255) NOT NULL,
	"chat_id" bigint NOT NULL,
	"max_user_id" bigint,
	"message_id" varchar(255),
	"body_text" text NOT NULL,
	"status" "bot_inquiry_status" DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_inquiries_event_key_unique" UNIQUE("event_key"),
	CONSTRAINT "bot_inquiries_event_key_not_blank" CHECK (char_length(btrim("bot_inquiries"."event_key")) > 0),
	CONSTRAINT "bot_inquiries_max_user_id_positive" CHECK ("bot_inquiries"."max_user_id" is null or "bot_inquiries"."max_user_id" > 0),
	CONSTRAINT "bot_inquiries_message_id_not_blank" CHECK ("bot_inquiries"."message_id" is null or char_length(btrim("bot_inquiries"."message_id")) > 0),
	CONSTRAINT "bot_inquiries_body_text_not_blank" CHECK (char_length(btrim("bot_inquiries"."body_text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "max_bot_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(255) NOT NULL,
	"action_key" varchar(255) NOT NULL,
	"action" "max_bot_outbox_action" NOT NULL,
	"chat_id" bigint,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_message_id" varchar(255),
	"status" "max_bot_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "max_bot_outbox_action_key_unique" UNIQUE("action_key"),
	CONSTRAINT "max_bot_outbox_event_key_not_blank" CHECK (char_length(btrim("max_bot_outbox"."event_key")) > 0),
	CONSTRAINT "max_bot_outbox_action_key_not_blank" CHECK (char_length(btrim("max_bot_outbox"."action_key")) > 0),
	CONSTRAINT "max_bot_outbox_payload_object" CHECK (jsonb_typeof("max_bot_outbox"."payload") = 'object'),
	CONSTRAINT "max_bot_outbox_provider_message_id_not_blank" CHECK ("max_bot_outbox"."provider_message_id" is null or char_length(btrim("max_bot_outbox"."provider_message_id")) > 0),
	CONSTRAINT "max_bot_outbox_attempts_nonnegative" CHECK ("max_bot_outbox"."attempts" >= 0),
	CONSTRAINT "max_bot_outbox_chat_id_matches_action" CHECK (("max_bot_outbox"."action" = 'send_message' and "max_bot_outbox"."chat_id" is not null)
        or "max_bot_outbox"."action" = 'answer_callback'),
	CONSTRAINT "max_bot_outbox_completed_at_matches_status" CHECK (("max_bot_outbox"."status" = 'completed' and "max_bot_outbox"."completed_at" is not null)
        or ("max_bot_outbox"."status" <> 'completed' and "max_bot_outbox"."completed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "bot_inquiries" ADD CONSTRAINT "bot_inquiries_chat_id_bot_dialogs_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."bot_dialogs"("chat_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "max_bot_outbox" ADD CONSTRAINT "max_bot_outbox_chat_id_bot_dialogs_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."bot_dialogs"("chat_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "bot_dialogs_max_user_id_idx" ON "bot_dialogs" USING btree ("max_user_id") WHERE "bot_dialogs"."max_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_inquiries_message_id_uidx" ON "bot_inquiries" USING btree ("message_id") WHERE "bot_inquiries"."message_id" is not null;--> statement-breakpoint
CREATE INDEX "bot_inquiries_chat_created_at_idx" ON "bot_inquiries" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_inquiries_status_created_at_idx" ON "bot_inquiries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "max_bot_outbox_provider_message_id_uidx" ON "max_bot_outbox" USING btree ("provider_message_id") WHERE "max_bot_outbox"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "max_bot_outbox_ready_idx" ON "max_bot_outbox" USING btree ("status","next_attempt_at","created_at") WHERE "max_bot_outbox"."status" in ('pending', 'retry');--> statement-breakpoint
CREATE INDEX "max_bot_outbox_chat_order_idx" ON "max_bot_outbox" USING btree ("chat_id","created_at","id");
