-- EKONOMI: gemensam ekonomisk uppföljning för Stodona AB och Stodona Services AB (2026-10-02).
-- Skapar enbart nya tabeller (fin_*). Rör inga befintliga tabeller.
-- Idempotent: kan köras flera gånger utan att något förstörs.

CREATE TABLE IF NOT EXISTS "fin_connections" (
  "company_id"         TEXT PRIMARY KEY,
  "token_enc"          TEXT,
  "scopes"             TEXT,
  "fortnox_name"       TEXT,
  "fortnox_org_number" TEXT,
  "connected_at"       TIMESTAMP(3),
  "connected_by"       TEXT,
  "last_attempt_at"    TIMESTAMP(3),
  "last_success_at"    TIMESTAMP(3),
  "last_error"         TEXT,
  "locked_until"       TEXT,
  "ledger_synced_at"   TIMESTAMP(3),
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "fin_fiscal_years" (
  "company_id"  TEXT NOT NULL,
  "fy_id"       INTEGER NOT NULL,
  "from_date"   TEXT NOT NULL,
  "to_date"     TEXT NOT NULL,
  "imported_at" TIMESTAMP(3),
  "balances"    JSONB,
  CONSTRAINT "fin_fiscal_years_pkey" PRIMARY KEY ("company_id", "fy_id")
);

CREATE TABLE IF NOT EXISTS "fin_accounts" (
  "company_id"    TEXT NOT NULL,
  "number"        TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "sie_type"      TEXT,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_accounts_pkey" PRIMARY KEY ("company_id", "number")
);

CREATE TABLE IF NOT EXISTS "fin_vouchers" (
  "company_id" TEXT NOT NULL,
  "fy_id"      INTEGER NOT NULL,
  "series"     TEXT NOT NULL,
  "number"     INTEGER NOT NULL,
  "date"       TEXT NOT NULL,
  "text"       TEXT NOT NULL,
  "rows"       JSONB NOT NULL,
  "hash"       TEXT NOT NULL,
  "ref_type"   TEXT,
  "ref_number" TEXT,
  CONSTRAINT "fin_vouchers_pkey" PRIMARY KEY ("company_id", "fy_id", "series", "number")
);
CREATE INDEX IF NOT EXISTS "fin_vouchers_company_id_date_idx" ON "fin_vouchers" ("company_id", "date");

CREATE TABLE IF NOT EXISTS "fin_ledger_items" (
  "company_id"          TEXT NOT NULL,
  "kind"                TEXT NOT NULL,
  "doc_number"          TEXT NOT NULL,
  "external_ref"        TEXT NOT NULL,
  "counterparty_number" TEXT NOT NULL,
  "counterparty_name"   TEXT NOT NULL,
  "invoice_date"        TEXT NOT NULL,
  "due_date"            TEXT NOT NULL,
  "total"               BIGINT NOT NULL,
  "balance"             BIGINT NOT NULL,
  "currency"            TEXT NOT NULL,
  "booked"              BOOLEAN NOT NULL,
  "cancelled"           BOOLEAN NOT NULL,
  "is_credit"           BOOLEAN NOT NULL,
  CONSTRAINT "fin_ledger_items_pkey" PRIMARY KEY ("company_id", "kind", "doc_number")
);

CREATE TABLE IF NOT EXISTS "fin_changes" (
  "id"            SERIAL PRIMARY KEY,
  "company_id"    TEXT NOT NULL,
  "fy_id"         INTEGER NOT NULL,
  "series"        TEXT NOT NULL,
  "number"        INTEGER NOT NULL,
  "type"          TEXT NOT NULL,
  "date"          TEXT NOT NULL,
  "previous_date" TEXT,
  "delta"         JSONB NOT NULL,
  "detected_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "fin_changes_company_id_date_idx" ON "fin_changes" ("company_id", "date");
CREATE INDEX IF NOT EXISTS "fin_changes_detected_at_idx" ON "fin_changes" ("detected_at" DESC);

CREATE TABLE IF NOT EXISTS "fin_import_runs" (
  "id"          SERIAL PRIMARY KEY,
  "company_id"  TEXT NOT NULL,
  "started_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "status"      TEXT NOT NULL,
  "error"       TEXT,
  "stats"       JSONB
);
CREATE INDEX IF NOT EXISTS "fin_import_runs_company_id_started_at_idx" ON "fin_import_runs" ("company_id", "started_at" DESC);

CREATE TABLE IF NOT EXISTS "fin_config" (
  "key"        TEXT PRIMARY KEY,
  "value"      JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" TEXT
);
