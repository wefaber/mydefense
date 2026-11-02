CREATE TABLE `chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL,
	`source_id` text NOT NULL,
	`path` text NOT NULL,
	`idx` integer NOT NULL,
	`text` text NOT NULL,
	`hash` text NOT NULL,
	`model` text,
	`emb` blob,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chunks_source` ON `chunks` (`source_id`);--> statement-breakpoint
CREATE INDEX `chunks_team_hash` ON `chunks` (`team_id`,`hash`);--> statement-breakpoint
CREATE TABLE `source_files` (
	`source_id` text NOT NULL,
	`path` text NOT NULL,
	`blob_sha` text NOT NULL,
	`chunks` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_files_path` ON `source_files` (`source_id`,`path`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`kind` text NOT NULL,
	`repo` text NOT NULL,
	`folder` text NOT NULL,
	`ref` text NOT NULL,
	`tree_sha` text NOT NULL,
	`file_count` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`embedded_count` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sources_team` ON `sources` (`team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sources_spec` ON `sources` (`team_id`,`repo`,`folder`,`ref`);--> statement-breakpoint
-- Hand-written: drizzle-kit does not model FTS5. rowid = chunks.id; rows are written and removed by server/db/knowledge.ts.
CREATE VIRTUAL TABLE `chunks_fts` USING fts5(text, tokenize = 'unicode61 remove_diacritics 2');
