-- OpsTask — spårning av completion + arkivering
-- Idempotent. Arkiverar (INTE raderar) PIPELINE + PERSONAL rader så att
-- historiken bevaras men UI:et bara visar ACTION-uppgifter.

ALTER TABLE "ops_tasks" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);
ALTER TABLE "ops_tasks" ADD COLUMN IF NOT EXISTS "completed_by" TEXT;
ALTER TABLE "ops_tasks" ADD COLUMN IF NOT EXISTS "archived_at"  TIMESTAMP(3);

-- Backfill: existerande DONE-rader — sätt completed_at = updated_at så vi
-- har något att sortera på (approximation men bättre än NULL).
UPDATE "ops_tasks"
   SET "completed_at" = "updated_at"
 WHERE "status" = 'DONE' AND "completed_at" IS NULL;

-- ARKIVERA Pipeline + Personliga tasks (data bevaras, döljs från UI).
-- Kör bara på rader som inte redan är soft-deleted eller arkiverade.
UPDATE "ops_tasks"
   SET "archived_at" = CURRENT_TIMESTAMP
 WHERE "section" IN ('PIPELINE', 'PERSONAL')
   AND "archived_at" IS NULL
   AND "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "ops_tasks_status_deadline_idx"
  ON "ops_tasks" ("status", "deadline");
