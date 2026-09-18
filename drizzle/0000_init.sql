CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`user_id` text,
	`anonymous_id` text,
	`session_id` text,
	`name` text NOT NULL,
	`props_json` text,
	`path` text,
	`referrer` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_name_idx` ON `analytics_events` (`name`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_org_idx` ON `analytics_events` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_anon_idx` ON `analytics_events` (`anonymous_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes_json` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_uq` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_org_idx` ON `api_keys` (`org_id`);--> statement-breakpoint
CREATE INDEX `api_keys_prefix_idx` ON `api_keys` (`key_prefix`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`actor_user_id` text,
	`actor_type` text DEFAULT 'user' NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`meta_json` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_org_idx` ON `audit_logs` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_target_idx` ON `audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `compliance_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`scan_id` text,
	`control_id` text NOT NULL,
	`status` text DEFAULT 'missing' NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`rationale` text NOT NULL,
	`evidence_json` text,
	`remediation` text,
	`owner_user_id` text,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`control_id`) REFERENCES `compliance_controls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessments_uq` ON `compliance_assessments` (`org_id`,`repository_id`,`control_id`);--> statement-breakpoint
CREATE INDEX `assessments_repo_idx` ON `compliance_assessments` (`repository_id`);--> statement-breakpoint
CREATE INDEX `assessments_org_status_idx` ON `compliance_assessments` (`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `compliance_controls` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`legal_ref` text NOT NULL,
	`obligation` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`evidence_types_json` text NOT NULL,
	`applicability_rule` text DEFAULT 'always' NOT NULL,
	`remediation` text NOT NULL,
	`references_json` text,
	`evaluation` text DEFAULT 'automated' NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `controls_domain_idx` ON `compliance_controls` (`domain`);--> statement-breakpoint
CREATE INDEX `controls_active_idx` ON `compliance_controls` (`is_active`);--> statement-breakpoint
CREATE TABLE `component_vulnerabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`scan_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`component_id` text NOT NULL,
	`vulnerability_id` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`exploitability` text DEFAULT 'unknown' NOT NULL,
	`exposure` text DEFAULT 'unknown' NOT NULL,
	`remediation` text,
	`fixed_version` text,
	`sla_due_at` integer,
	`rationale` text,
	`assigned_user_id` text,
	`resolved_at` integer,
	`detected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vulnerability_id`) REFERENCES `vulnerabilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cv_org_state_idx` ON `component_vulnerabilities` (`org_id`,`state`);--> statement-breakpoint
CREATE INDEX `cv_repo_idx` ON `component_vulnerabilities` (`repository_id`,`state`);--> statement-breakpoint
CREATE INDEX `cv_component_idx` ON `component_vulnerabilities` (`component_id`);--> statement-breakpoint
CREATE INDEX `cv_vuln_idx` ON `component_vulnerabilities` (`vulnerability_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cv_scan_component_vuln_uq` ON `component_vulnerabilities` (`scan_id`,`component_id`,`vulnerability_id`);--> statement-breakpoint
CREATE TABLE `components` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`scan_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`name` text NOT NULL,
	`version` text,
	`ecosystem` text NOT NULL,
	`purl` text,
	`group` text,
	`licenses_json` text,
	`scope` text DEFAULT 'runtime' NOT NULL,
	`manifest_path` text,
	`is_direct` integer DEFAULT false NOT NULL,
	`description` text,
	`homepage` text,
	`latest_version` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `components_scan_idx` ON `components` (`scan_id`);--> statement-breakpoint
CREATE INDEX `components_org_repo_idx` ON `components` (`org_id`,`repository_id`);--> statement-breakpoint
CREATE INDEX `components_purl_idx` ON `components` (`purl`);--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`percent_off` integer DEFAULT 0 NOT NULL,
	`bonus_credits` integer DEFAULT 0 NOT NULL,
	`max_redemptions` integer,
	`redeemed_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupons_code_uq` ON `coupons` (`code`);--> statement-breakpoint
CREATE TABLE `credit_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`lifetime_purchased` integer DEFAULT 0 NOT NULL,
	`lifetime_granted` integer DEFAULT 0 NOT NULL,
	`lifetime_consumed` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_accounts_org_uq` ON `credit_accounts` (`org_id`);--> statement-breakpoint
CREATE TABLE `credit_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`credits` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`bonus_credits` integer DEFAULT 0 NOT NULL,
	`popular` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`provider_product_id` text,
	`sort_order` integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_packs_key_currency_uq` ON `credit_packs` (`key`,`currency`);--> statement-breakpoint
CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`description` text,
	`expires_at` integer,
	`created_by_user_id` text,
	`idempotency_key` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `credit_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_tx_idem_uq` ON `credit_transactions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_tx_account_idx` ON `credit_transactions` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `credit_tx_org_idx` ON `credit_transactions` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `credit_tx_ref_idx` ON `credit_transactions` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`scan_id` text NOT NULL,
	`from_component_id` text NOT NULL,
	`to_component_id` text NOT NULL,
	`type` text DEFAULT 'dependsOn' NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dependencies_scan_idx` ON `dependencies` (`scan_id`);--> statement-breakpoint
CREATE INDEX `dependencies_to_idx` ON `dependencies` (`to_component_id`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`repository_id` text,
	`scan_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`storage_key` text,
	`file_name` text,
	`mime_type` text,
	`size_bytes` integer,
	`sha256` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`control_ids_json` text,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`previous_evidence_id` text,
	`retention_until` integer,
	`created_by_user_id` text,
	`seq` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_org_idx` ON `evidence` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `evidence_repo_idx` ON `evidence` (`repository_id`);--> statement-breakpoint
CREATE INDEX `evidence_sha_idx` ON `evidence` (`sha256`);--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`description` text,
	`enabled` integer DEFAULT false NOT NULL,
	`value_json` text,
	`rollout_pct` integer DEFAULT 100 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`provider_login` text,
	`access_token_enc` text,
	`refresh_token_enc` text,
	`token_expires_at` integer,
	`scope` text,
	`profile_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_uq` ON `identities` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE INDEX `identities_user_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `incident_events` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`org_id` text NOT NULL,
	`type` text NOT NULL,
	`stage` text DEFAULT 'none' NOT NULL,
	`payload_json` text,
	`note` text,
	`actor_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `incident_events_incident_idx` ON `incident_events` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `incident_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`org_id` text NOT NULL,
	`stage` text NOT NULL,
	`title` text NOT NULL,
	`body_markdown` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`generated_by` text DEFAULT 'template' NOT NULL,
	`sources_json` text NOT NULL,
	`ai_confidence` text,
	`ai_model` text,
	`created_by_user_id` text,
	`approved_by_user_id` text,
	`approved_at` integer,
	`exported_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_reports_uq` ON `incident_reports` (`incident_id`,`stage`);--> statement-breakpoint
CREATE INDEX `incident_reports_org_idx` ON `incident_reports` (`org_id`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`repository_id` text,
	`component_vulnerability_id` text,
	`vulnerability_id` text,
	`title` text NOT NULL,
	`state` text DEFAULT 'detected' NOT NULL,
	`severity` text NOT NULL,
	`awareness_at` integer NOT NULL,
	`detected_at` integer NOT NULL,
	`early_warning_due_at` integer NOT NULL,
	`notification_due_at` integer NOT NULL,
	`final_report_due_at` integer,
	`kev_flag` integer DEFAULT false NOT NULL,
	`actively_exploited` integer DEFAULT false NOT NULL,
	`severity_rationale` text,
	`affected_summary_json` text,
	`assignee_user_id` text,
	`created_by_user_id` text,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `incidents_org_idx` ON `incidents` (`org_id`,`state`);--> statement-breakpoint
CREATE INDEX `incidents_repo_idx` ON `incidents` (`repository_id`);--> statement-breakpoint
CREATE INDEX `incidents_due_idx` ON `incidents` (`early_warning_due_at`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`provider` text NOT NULL,
	`installation_id` text NOT NULL,
	`account_login` text,
	`account_type` text,
	`permissions_json` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_provider_install_uq` ON `integrations` (`provider`,`installation_id`);--> statement-breakpoint
CREATE INDEX `integrations_org_idx` ON `integrations` (`org_id`);--> statement-breakpoint
CREATE TABLE `intel_sources` (
	`key` text PRIMARY KEY NOT NULL,
	`last_run_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`meta_json` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by_user_id` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_uq` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invites_org_idx` ON `invites` (`org_id`);--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`org_id` text,
	`status` text NOT NULL,
	`progress_pct` integer DEFAULT 0 NOT NULL,
	`message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_events_job_idx` ON `job_events` (`job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`dedupe_key` text,
	`run_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`progress_pct` integer DEFAULT 0 NOT NULL,
	`progress_message` text,
	`last_error` text,
	`result_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_runat_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_org_idx` ON `jobs` (`org_id`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_idx` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `kev_entries` (
	`cve_id` text PRIMARY KEY NOT NULL,
	`vendor_project` text,
	`product` text,
	`vulnerability_name` text,
	`date_added` text,
	`short_description` text,
	`required_action` text,
	`due_date` text,
	`known_ransomware` text,
	`notes` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kev_product_idx` ON `kev_entries` (`product`);--> statement-breakpoint
CREATE TABLE `magic_links` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`redirect_to` text,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `magic_links_token_hash_uq` ON `magic_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `magic_links_email_idx` ON `magic_links` (`email`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link_url` text,
	`severity` text DEFAULT 'info' NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notifications_org_idx` ON `notifications` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`invited_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_uq` ON `organization_members` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `organization_members_user_idx` ON `organization_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `organization_members_org_role_idx` ON `organization_members` (`org_id`,`role`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`plan_key` text DEFAULT 'free' NOT NULL,
	`billing_email` text,
	`country` text,
	`vat_id` text,
	`company_legal_name` text,
	`parent_org_id` text,
	`is_agency` integer DEFAULT false NOT NULL,
	`auto_topup_enabled` integer DEFAULT false NOT NULL,
	`auto_topup_threshold_credits` integer DEFAULT 100 NOT NULL,
	`auto_topup_pack_key` text,
	`retention_days` integer DEFAULT 365 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`seats` integer DEFAULT 5 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_uq` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `organizations_parent_idx` ON `organizations` (`parent_org_id`);--> statement-breakpoint
CREATE INDEX `organizations_status_idx` ON `organizations` (`status`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_payment_id` text,
	`provider_checkout_id` text,
	`provider_customer_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`pack_key` text,
	`credits_granted` integer DEFAULT 0 NOT NULL,
	`receipt_url` text,
	`checkout_url` text,
	`failure_reason` text,
	`raw_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_id_uq` ON `payments` (`provider`,`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `payments_org_idx` ON `payments` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`interval` text DEFAULT 'month' NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`credits_included` integer DEFAULT 0 NOT NULL,
	`repo_limit` integer DEFAULT 1 NOT NULL,
	`seat_limit` integer DEFAULT 3 NOT NULL,
	`features_json` text,
	`provider_product_id` text,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_key_currency_uq` ON `plans` (`key`,`currency`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`product_name` text,
	`product_version` text,
	`support_period_months` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_org_slug_uq` ON `projects` (`org_id`,`slug`);--> statement-breakpoint
CREATE INDEX `projects_org_idx` ON `projects` (`org_id`);--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`referrer_user_id` text NOT NULL,
	`code` text NOT NULL,
	`referred_org_id` text,
	`reward_credits` integer DEFAULT 200 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`converted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referrals_code_uq` ON `referrals` (`code`);--> statement-breakpoint
CREATE INDEX `referrals_org_idx` ON `referrals` (`org_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`repository_id` text,
	`scan_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content_json` text,
	`storage_key` text,
	`share_token` text,
	`share_expires_at` integer,
	`credits_charged` integer DEFAULT 0 NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reports_org_idx` ON `reports` (`org_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reports_share_token_uq` ON `reports` (`share_token`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text,
	`integration_id` text,
	`provider` text DEFAULT 'github' NOT NULL,
	`external_id` text,
	`owner` text,
	`name` text NOT NULL,
	`full_name` text,
	`default_branch` text,
	`url` text,
	`visibility` text,
	`last_scan_id` text,
	`last_scan_at` integer,
	`fingerprint` text,
	`monitoring_enabled` integer DEFAULT false NOT NULL,
	`schedule` text DEFAULT 'daily',
	`badge_enabled` integer DEFAULT false NOT NULL,
	`badge_token` text,
	`readiness_score` real,
	`open_critical` integer DEFAULT 0 NOT NULL,
	`open_high` integer DEFAULT 0 NOT NULL,
	`open_kev` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `repositories_org_idx` ON `repositories` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `repositories_project_idx` ON `repositories` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_badge_token_uq` ON `repositories` (`badge_token`);--> statement-breakpoint
CREATE TABLE `sboms` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`scan_id` text NOT NULL,
	`format` text DEFAULT 'cyclonedx-json' NOT NULL,
	`spec_version` text DEFAULT '1.6' NOT NULL,
	`serial_number` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`storage_key` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`sha256` text NOT NULL,
	`component_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sboms_repo_idx` ON `sboms` (`repository_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sboms_serial_uq` ON `sboms` (`serial_number`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`job_id` text,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`ref` text,
	`commit_sha` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`fingerprint` text,
	`skipped_reason` text,
	`ecosystems_json` text,
	`manifests_json` text,
	`component_count` integer DEFAULT 0 NOT NULL,
	`vulnerability_count` integer DEFAULT 0 NOT NULL,
	`critical_count` integer DEFAULT 0 NOT NULL,
	`high_count` integer DEFAULT 0 NOT NULL,
	`medium_count` integer DEFAULT 0 NOT NULL,
	`low_count` integer DEFAULT 0 NOT NULL,
	`kev_count` integer DEFAULT 0 NOT NULL,
	`readiness_score` real,
	`duration_ms` integer,
	`progress_pct` integer DEFAULT 0 NOT NULL,
	`progress_message` text,
	`credits_charged` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scans_repo_idx` ON `scans` (`repository_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `scans_org_idx` ON `scans` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `scans_status_idx` ON `scans` (`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`expires_at` integer NOT NULL,
	`last_used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_uq` ON `share_links` (`token`);--> statement-breakpoint
CREATE INDEX `share_links_resource_idx` ON `share_links` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subscription_id` text,
	`plan_key` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`seats` integer DEFAULT 1 NOT NULL,
	`meta_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subscriptions_org_idx` ON `subscriptions` (`org_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_status_idx` ON `subscriptions` (`status`);--> statement-breakpoint
CREATE TABLE `system_events` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`meta_json` text,
	`org_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `system_events_level_idx` ON `system_events` (`level`,`created_at`);--> statement-breakpoint
CREATE INDEX `system_events_source_idx` ON `system_events` (`source`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text,
	`api_key_id` text,
	`action` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`reservation_transaction_id` text,
	`commit_transaction_id` text,
	`meta_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `usage_org_idx` ON `usage_events` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_action_idx` ON `usage_events` (`action`);--> statement-breakpoint
CREATE INDEX `usage_status_idx` ON `usage_events` (`status`);--> statement-breakpoint
CREATE TABLE `usage_rules` (
	`action` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`credits` integer NOT NULL,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_normalised` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`password_hash` text,
	`email_verified_at` integer,
	`is_system_admin` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_login_at` integer,
	`default_org_id` text,
	`timezone` text DEFAULT 'UTC',
	`locale` text DEFAULT 'en',
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_normalised_uq` ON `users` (`email_normalised`);--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);--> statement-breakpoint
CREATE TABLE `vulnerabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`aliases_json` text,
	`summary` text,
	`details` text,
	`severity` text DEFAULT 'unknown' NOT NULL,
	`cvss_score` real,
	`cvss_vector` text,
	`cvss_version` text,
	`epss_score` real,
	`epss_percentile` real,
	`kev_flag` integer DEFAULT false NOT NULL,
	`kev_date_added` text,
	`kev_due_date` text,
	`exploit_maturity` text,
	`weaknesses_json` text,
	`references_json` text,
	`affected_ranges_json` text,
	`fixed_versions_json` text,
	`published_at` integer,
	`modified_at` integer,
	`withdrawn_at` integer,
	`raw_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vulns_severity_idx` ON `vulnerabilities` (`severity`);--> statement-breakpoint
CREATE INDEX `vulns_kev_idx` ON `vulnerabilities` (`kev_flag`);--> statement-breakpoint
CREATE INDEX `vulns_modified_idx` ON `vulnerabilities` (`modified_at`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`org_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`response_status` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_hook_idx` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`url` text NOT NULL,
	`secret_enc` text NOT NULL,
	`events_json` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhooks_org_idx` ON `webhooks` (`org_id`);