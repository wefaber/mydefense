CREATE TABLE `defenses` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`criteria` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `defenses_team` ON `defenses` (`team_id`);--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`sectors` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_team_key` ON `identities` (`team_id`,`key`);--> statement-breakpoint
CREATE TABLE `points` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`defense_id` text NOT NULL,
	`section_id` text NOT NULL,
	`owner_id` text,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`script` text NOT NULL,
	`say` text NOT NULL,
	`refs` text NOT NULL,
	`status` text NOT NULL,
	`todo` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`defense_id`) REFERENCES `defenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `points_defense_code` ON `points` (`defense_id`,`code`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`defense_id` text NOT NULL,
	`point_id` text,
	`group` text NOT NULL,
	`prompt` text NOT NULL,
	`model_answer` text NOT NULL,
	`source` text NOT NULL,
	`extra` text NOT NULL,
	`status` text NOT NULL,
	`validator_notes` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`defense_id`) REFERENCES `defenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`point_id`) REFERENCES `points`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `questions_team_group` ON `questions` (`team_id`,`group`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`defense_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`defense_id`) REFERENCES `defenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `resources_team_kind` ON `resources` (`team_id`,`kind`);--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`defense_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`defense_id`) REFERENCES `defenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sections_defense_number` ON `sections` (`defense_id`,`number`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`visibility` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_slug` ON `teams` (`slug`);