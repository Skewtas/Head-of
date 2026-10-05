CREATE TABLE IF NOT EXISTS "monthly_goals" (
  "id"                        SERIAL        PRIMARY KEY,
  "month"                     TEXT          NOT NULL,
  "booked_revenue"            INTEGER       NOT NULL,
  "avg_price_per_hour"        INTEGER       NOT NULL,
  "recurring_private_clients" INTEGER       NOT NULL,
  "recurring_company_clients" INTEGER       NOT NULL,
  "staff_count"               INTEGER       NOT NULL,
  "online_bookings"           INTEGER       NOT NULL,
  "updated_at"                TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by"                TEXT,
  CONSTRAINT "monthly_goals_month_key" UNIQUE ("month")
);
