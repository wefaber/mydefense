CREATE TABLE `github_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`github_id` text NOT NULL,
	`org` text NOT NULL,
	`member` integer NOT NULL,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_links_github_id` ON `github_links` (`github_id`);