-- Sjukfrånvaro-uppföljning (HR) — Fas 1
-- Idempotent. Skapar SickCaseStatus enum + sick_leave_cases + sick_leave_case_events.

DO $$ BEGIN
  CREATE TYPE "SickCaseStatus" AS ENUM (
    'NEW',
    'UNDER_REVIEW',
    'EMAIL1_DRAFTED',
    'EMAIL1_SENT',
    'MEETING_SCHEDULED',
    'MEETING_HELD',
    'EMAIL2_DRAFTED',
    'EMAIL2_SENT',
    'RESOLVED',
    'DISMISSED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "sick_leave_cases" (
  "id" SERIAL PRIMARY KEY,
  "timewave_employee_id" INTEGER NOT NULL,
  "employee_name" TEXT NOT NULL,
  "episodes_count" INTEGER NOT NULL,
  "days_count" INTEGER NOT NULL,
  "window_start_date" TIMESTAMP(3) NOT NULL,
  "window_end_date" TIMESTAMP(3) NOT NULL,
  "status" "SickCaseStatus" NOT NULL DEFAULT 'NEW',
  "assigned_to_clerk_id" TEXT,
  "dismiss_reason" TEXT,
  "notes" TEXT,
  "meeting_date" TIMESTAMP(3),
  "intyg_start_date" TIMESTAMP(3),
  "intyg_end_date" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "sick_leave_cases_status_created_at_idx"
  ON "sick_leave_cases" ("status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "sick_leave_cases_timewave_employee_id_created_at_idx"
  ON "sick_leave_cases" ("timewave_employee_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "sick_leave_case_events" (
  "id" SERIAL PRIMARY KEY,
  "case_id" INTEGER NOT NULL REFERENCES "sick_leave_cases"("id") ON DELETE CASCADE,
  "actor_clerk_id" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "sick_leave_case_events_case_id_created_at_idx"
  ON "sick_leave_case_events" ("case_id", "created_at" DESC);
