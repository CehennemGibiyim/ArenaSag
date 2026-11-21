CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"city" text DEFAULT 'İstanbul' NOT NULL,
	"commission_rate" integer DEFAULT 20 NOT NULL,
	"tier" text DEFAULT 'growth' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"event_type" text DEFAULT 'gift' NOT NULL,
	"gift_name" text DEFAULT '' NOT NULL,
	"threshold" integer DEFAULT 100 NOT NULL,
	"action" text DEFAULT 'overlay' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"sound" text DEFAULT 'arena-hit' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"match_type" text DEFAULT 'contains' NOT NULL,
	"response" text DEFAULT '' NOT NULL,
	"action" text DEFAULT 'reply' NOT NULL,
	"cooldown" integer DEFAULT 15 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chests" (
	"id" serial PRIMARY KEY NOT NULL,
	"envelope_id" text DEFAULT '' NOT NULL,
	"room_id" text DEFAULT '' NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"avatar" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'chest' NOT NULL,
	"variant" text DEFAULT 'normal' NOT NULL,
	"skin_id" integer DEFAULT 1 NOT NULL,
	"business_type" integer DEFAULT 1 NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"slots" integer DEFAULT 1 NOT NULL,
	"joined" integer DEFAULT 0 NOT NULL,
	"viewers" integer DEFAULT 0 NOT NULL,
	"opens_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"source" text DEFAULT 'connector' NOT NULL,
	"claimed_by" text DEFAULT '' NOT NULL,
	"claimed_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cohost_candidates" (
	"room_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"agency_id" integer,
	"followers" integer DEFAULT 0 NOT NULL,
	"category" text DEFAULT 'sohbet' NOT NULL,
	"live_status" text DEFAULT 'offline' NOT NULL,
	"avg_viewers" integer DEFAULT 0 NOT NULL,
	"diamonds" integer DEFAULT 0 NOT NULL,
	"tiktok_id" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quota" jsonb,
	"state" text DEFAULT 'empty' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"repo" text DEFAULT '' NOT NULL,
	"package_name" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'TypeScript' NOT NULL,
	"category" text DEFAULT 'live' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"install" text DEFAULT '' NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"integration" text DEFAULT 'available' NOT NULL,
	"momentum" text DEFAULT 'high' NOT NULL,
	"docs_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listener_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"username" text NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"viewers" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"lease_until" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"listened_seconds" integer DEFAULT 0 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"type" text NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"gift_name" text DEFAULT '' NOT NULL,
	"diamond_count" integer DEFAULT 0 NOT NULL,
	"repeat_count" integer DEFAULT 1 NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"room_id" text DEFAULT '' NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"avatar" text DEFAULT '' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"region_basis" text DEFAULT 'unknown' NOT NULL,
	"verified_at" timestamp with time zone,
	"probed_at" timestamp with time zone,
	"source" text DEFAULT 'watchlist' NOT NULL,
	"viewers" integer DEFAULT 0 NOT NULL,
	"peak_viewers" integer DEFAULT 0 NOT NULL,
	"diamonds" integer DEFAULT 0 NOT NULL,
	"diamonds_per_min" integer DEFAULT 0 NOT NULL,
	"chest_count" integer DEFAULT 0 NOT NULL,
	"best_chest_coins" integer DEFAULT 0 NOT NULL,
	"best_chest_slots" integer DEFAULT 0 NOT NULL,
	"best_chest_ratio" integer DEFAULT 0 NOT NULL,
	"last_chest_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"live_now" boolean DEFAULT false NOT NULL,
	"monitoring" boolean DEFAULT false NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"room_id" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'demo' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"peak_viewers" integer DEFAULT 0 NOT NULL,
	"viewers" integer DEFAULT 0 NOT NULL,
	"diamonds" integer DEFAULT 0 NOT NULL,
	"gifts" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"connector_error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'canli-yayin' NOT NULL,
	"budget" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"deadline" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"commission" integer DEFAULT 15 NOT NULL,
	"requirements" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'Arena Radar' NOT NULL,
	"match_score" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overlays" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'goal' NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"accent" text DEFAULT 'cyan' NOT NULL,
	"goal" integer DEFAULT 5000 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_gates" (
	"provider" text PRIMARY KEY NOT NULL,
	"starts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_scans" (
	"report" jsonb,
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"checked" integer DEFAULT 0 NOT NULL,
	"live_found" integer DEFAULT 0 NOT NULL,
	"chests_found" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'watchlist' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" integer,
	"source" text DEFAULT 'hediye' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"diamonds" integer DEFAULT 0 NOT NULL,
	"commission" integer DEFAULT 20 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_flows" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"room_id" text DEFAULT '' NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"diamonds" integer DEFAULT 0 NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"senders" integer DEFAULT 0 NOT NULL,
	"top_senders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diamonds_per_min" integer DEFAULT 0 NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"has_envelope" boolean DEFAULT false NOT NULL,
	"envelope_id" text DEFAULT '' NOT NULL,
	"viewers" integer DEFAULT 0 NOT NULL,
	"live_now" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" integer DEFAULT 0 NOT NULL,
	"username" text NOT NULL,
	"room_id" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"viewer_count" integer DEFAULT 0 NOT NULL,
	"diamonds" integer DEFAULT 0 NOT NULL,
	"gift_events" integer DEFAULT 0 NOT NULL,
	"chests_found" integer DEFAULT 0 NOT NULL,
	"listen_seconds" integer DEFAULT 0 NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "target_stats" (
	"username" text PRIMARY KEY NOT NULL,
	"live_hours" integer[] DEFAULT '{}' NOT NULL,
	"check_hours" integer[] DEFAULT '{}' NOT NULL,
	"offline_streak" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"category" text DEFAULT 'sohbet' NOT NULL,
	"live_now" boolean DEFAULT false NOT NULL,
	"viewers" integer DEFAULT 0 NOT NULL,
	"diamonds" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chests_envelope_idx" ON "chests" USING btree ("envelope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_username_idx" ON "creators" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "listener_jobs_room_idx" ON "listener_jobs" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_rooms_username_idx" ON "live_rooms" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "overlays_slug_idx" ON "overlays" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "room_flows_username_idx" ON "room_flows" USING btree ("username");