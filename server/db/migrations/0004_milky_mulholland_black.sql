CREATE TABLE `generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`total` integer NOT NULL,
	`done` integer NOT NULL,
	`error` text NOT NULL,
	`draft` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_runs_team` ON `generation_runs` (`team_id`);