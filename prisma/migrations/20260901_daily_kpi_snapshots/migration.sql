-- Dagliga KPI-snapshots för att spåra dygnsförändring på översikten.
-- Idempotent: skapar tabell om den inte finns.

CREATE TABLE IF NOT EXISTS "daily_kpi_snapshots" (
  "id"                        SERIAL PRIMARY KEY,
  "date"                      DATE NOT NULL UNIQUE,
  "booked_revenue"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "invoiced_revenue"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avg_price_per_hour"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "recurring_private_clients" INTEGER NOT NULL DEFAULT 0,
  "recurring_company_clients" INTEGER NOT NULL DEFAULT 0,
  "staff_count"               INTEGER NOT NULL DEFAULT 0,
  "online_bookings"           INTEGER NOT NULL DEFAULT 0,
  "metadata"                  JSONB,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "daily_kpi_snapshots_date_desc_idx"
  ON "daily_kpi_snapshots" ("date" DESC);
