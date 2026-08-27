-- ============================================================================
-- AVTALSHANTERING — Contract management module
-- Idempotent så samma migration kan köras om via admin-endpoint.
-- ============================================================================

-- Enums (PG stödjer inte IF NOT EXISTS på CREATE TYPE → DO-block med exception)
DO $$ BEGIN
  CREATE TYPE "ContractStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','READY_FOR_SIGNING','SENT','PARTIALLY_SIGNED','SIGNED','ACTIVE','EXPIRING_SOON','EXPIRED','TERMINATED','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContractCategory" AS ENUM (
    'ANSTALLNINGSAVTAL','PROVANSTALLNING','TILLSVIDAREANSTALLNING','VISSTIDSANSTALLNING','TIMANSTALLNING','ANDRING_ANSTALLNINGSVILLKOR','LONEANDRING','SEKRETESSAVTAL','KONKURRENSAVTAL','OVERENSKOMMELSE','AVSLUT_ANSTALLNING',
    'KUNDAVTAL','LEVERANTORSAVTAL','KONSULTAVTAL','SAMARBETSAVTAL','HYRESAVTAL','LEASINGAVTAL','LICENSAVTAL','PUB_AVTAL','OVRIGT_AVTAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "ContractPermissionLevel" AS ENUM ('READ','COMMENT','EDIT','ADMIN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SignerStatus" AS ENUM ('PENDING','VIEWED','SIGNED','DECLINED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ReminderType" AS ENUM ('START_DATE','END_DATE_APPROACHING','NOTICE_DEADLINE','PROBATION_END','RENEWAL','CUSTOM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabeller
CREATE TABLE IF NOT EXISTS "own_companies" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "organization_number" TEXT NOT NULL UNIQUE,
  "address" TEXT,
  "postal_code" TEXT,
  "city" TEXT,
  "logo_url" TEXT,
  "signatory_name" TEXT,
  "signatory_email" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "contract_persons" (
  "id" SERIAL PRIMARY KEY,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "personal_number" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "postal_code" TEXT,
  "city" TEXT,
  "linked_employee_id" INTEGER REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "contract_persons_last_first_idx" ON "contract_persons"("last_name","first_name");

CREATE TABLE IF NOT EXISTS "contract_templates" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "category" "ContractCategory" NOT NULL,
  "own_company_id" INTEGER REFERENCES "own_companies"("id") ON DELETE SET NULL,
  "content" TEXT NOT NULL,
  "variables" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "contracts" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "category" "ContractCategory" NOT NULL,
  "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
  "own_company_id" INTEGER NOT NULL REFERENCES "own_companies"("id"),
  "person_id" INTEGER REFERENCES "contract_persons"("id") ON DELETE SET NULL,
  "external_company_name" TEXT,
  "external_company_org_nr" TEXT,
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "notice_date" TIMESTAMP(3),
  "probation_end_date" TIMESTAMP(3),
  "automatic_renewal" BOOLEAN NOT NULL DEFAULT false,
  "owner_clerk_id" TEXT NOT NULL,
  "template_id" INTEGER REFERENCES "contract_templates"("id") ON DELETE SET NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "contracts_status_end_date_idx" ON "contracts"("status","end_date");
CREATE INDEX IF NOT EXISTS "contracts_category_idx" ON "contracts"("category");
CREATE INDEX IF NOT EXISTS "contracts_owner_clerk_id_idx" ON "contracts"("owner_clerk_id");

CREATE TABLE IF NOT EXISTS "contract_versions" (
  "id" SERIAL PRIMARY KEY,
  "contract_id" INTEGER NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "pdf_url" TEXT,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "created_by_clerk_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("contract_id","version")
);

CREATE TABLE IF NOT EXISTS "contract_permissions" (
  "id" SERIAL PRIMARY KEY,
  "contract_id" INTEGER NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "clerk_user_id" TEXT NOT NULL,
  "level" "ContractPermissionLevel" NOT NULL,
  "granted_by_clerk_id" TEXT NOT NULL,
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  UNIQUE("contract_id","clerk_user_id")
);

CREATE TABLE IF NOT EXISTS "contract_signers" (
  "id" SERIAL PRIMARY KEY,
  "contract_id" INTEGER NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "signing_order" INTEGER NOT NULL DEFAULT 1,
  "status" "SignerStatus" NOT NULL DEFAULT 'PENDING',
  "signed_at" TIMESTAMP(3),
  "external_provider_id" TEXT,
  "audit_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "contract_signers_order_idx" ON "contract_signers"("contract_id","signing_order");

CREATE TABLE IF NOT EXISTS "contract_reminders" (
  "id" SERIAL PRIMARY KEY,
  "contract_id" INTEGER NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "reminder_date" TIMESTAMP(3) NOT NULL,
  "reminder_type" "ReminderType" NOT NULL,
  "message" TEXT,
  "recipient_emails" TEXT NOT NULL,
  "sent_at" TIMESTAMP(3),
  "handled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "contract_reminders_date_sent_idx" ON "contract_reminders"("reminder_date","sent_at");

CREATE TABLE IF NOT EXISTS "contract_attachments" (
  "id" SERIAL PRIMARY KEY,
  "contract_id" INTEGER NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "filename" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "file_url" TEXT NOT NULL,
  "uploaded_by_clerk_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
