CREATE TYPE "public"."item_tier" AS ENUM('highlight', 'feed', 'folded');--> statement-breakpoint
CREATE TABLE "entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mention_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"starred" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "entity_kind_canonical_name_unique" UNIQUE("kind","canonical_name"),
	CONSTRAINT "entity_kind_check" CHECK ("entity"."kind" in ('person', 'company')),
	CONSTRAINT "entity_mention_count_check" CHECK ("entity"."mention_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"signal" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_signal_check" CHECK ("feedback"."signal" in ('irrelevant', 'low_quality', 'great', 'opened_source', 'archive_requested'))
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"url_canonical" text NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"media_type" text NOT NULL,
	"published_at" timestamp with time zone,
	"duration_seconds" integer,
	"content_chars" integer,
	"cover_url" text,
	"simhash" bigint,
	"summary" text,
	"tags" text[],
	"persons" text[],
	"companies" text[],
	"is_founder_interview" boolean,
	"admission_confidence" real,
	"reject_reason" text,
	"model_version" text,
	"tier" "item_tier" DEFAULT 'feed' NOT NULL,
	"tier_score" real,
	"tier_reason" jsonb,
	"read_at" timestamp with time zone,
	"archive_requested_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"status" text DEFAULT 'ok' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_source_external_unique" UNIQUE("source_id","external_id"),
	CONSTRAINT "item_media_type_check" CHECK ("item"."media_type" in ('article', 'video', 'podcast')),
	CONSTRAINT "item_status_check" CHECK ("item"."status" in ('ok', 'needs_body', 'dead_link', 'failed')),
	CONSTRAINT "item_admission_confidence_check" CHECK ("item"."admission_confidence" is null or "item"."admission_confidence" between 0 and 1),
	CONSTRAINT "item_tier_score_check" CHECK ("item"."tier_score" is null or "item"."tier_score" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	CONSTRAINT "job_kind_check" CHECK ("job"."kind" in ('discover', 'process', 'rescore')),
	CONSTRAINT "job_status_check" CHECK ("job"."status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "job_attempts_check" CHECK ("job"."attempts" >= 0),
	CONSTRAINT "job_max_attempts_check" CHECK ("job"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"country" text,
	"language" text,
	"ingest_method" text NOT NULL,
	"fetch_mode" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"weight_locked" boolean DEFAULT false NOT NULL,
	"purity" real DEFAULT 0.7 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "source_ingest_method_check" CHECK ("source"."ingest_method" in ('rss', 'youtube', 'podcast', 'html')),
	CONSTRAINT "source_fetch_mode_check" CHECK ("source"."fetch_mode" in ('full', 'discover_only')),
	CONSTRAINT "source_weight_check" CHECK ("source"."weight" between 0.2 and 2.0),
	CONSTRAINT "source_purity_check" CHECK ("source"."purity" between 0 and 1),
	CONSTRAINT "source_consecutive_failures_check" CHECK ("source"."consecutive_failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_aliases_gin_idx" ON "entity" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "feedback_item_created_at_idx" ON "feedback" USING btree ("item_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "item_url_canonical_unique" ON "item" USING btree ("url_canonical");--> statement-breakpoint
CREATE INDEX "item_persons_gin_idx" ON "item" USING gin ("persons");--> statement-breakpoint
CREATE INDEX "item_companies_gin_idx" ON "item" USING gin ("companies");--> statement-breakpoint
CREATE INDEX "item_tags_gin_idx" ON "item" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "item_first_seen_at_idx" ON "item" USING btree ("first_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "item_archive_queue_idx" ON "item" USING btree ("archive_requested_at") WHERE "item"."archive_requested_at" is not null and "item"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "job_idempotency_key_unique" ON "job" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "job" USING btree ("run_after","id") WHERE "job"."status" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "source_url_unique" ON "source" USING btree ("url");