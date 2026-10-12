CREATE TABLE "mcp_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text,
	"actor_user_id" text NOT NULL,
	"authorization_user_id" text NOT NULL,
	"consent_id" text NOT NULL,
	"client_id" text NOT NULL,
	"operation" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" text,
	"status" varchar(16) NOT NULL,
	"error_code" varchar(64),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_audit_status_check" CHECK ("mcp_audit_log"."status" IN ('success', 'failure')),
	CONSTRAINT "mcp_audit_error_check" CHECK ("mcp_audit_log"."status" <> 'success' OR "mcp_audit_log"."error_code" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "mcp_consent_organization" (
	"consent_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "mcp_consent_organization_consent_id_organization_id_pk" PRIMARY KEY("consent_id","organization_id")
);
--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_org_time" ON "mcp_audit_log" USING btree ("organization_id","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_consent_time" ON "mcp_audit_log" USING btree ("consent_id","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "idx_mcp_consent_org_list" ON "mcp_consent_organization" USING btree ("organization_id","authorized_at" DESC,"consent_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_consent_org_member" ON "mcp_consent_organization" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mcp_request_identifier" ON "verification" USING btree ("identifier") WHERE "verification"."identifier" LIKE 'mcp-request:%';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mcp_request_pkce" ON "verification" USING btree (("value"::jsonb ->> 'userId'),("value"::jsonb ->> 'clientId'),("value"::jsonb ->> 'codeChallenge')) WHERE "verification"."identifier" LIKE 'mcp-request:%';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mcp_consent_user_client" ON "oauth_consent" USING btree ("user_id","client_id") WHERE "oauth_consent"."reference_id" LIKE 'mcp:%';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mcp_consent_reference" ON "oauth_consent" USING btree ("reference_id") WHERE "oauth_consent"."reference_id" LIKE 'mcp:%';--> statement-breakpoint
CREATE INDEX "idx_oauth_refresh_grant" ON "oauth_refresh_token" USING btree ("client_id","user_id","reference_id");