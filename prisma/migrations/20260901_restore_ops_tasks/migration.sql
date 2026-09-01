-- Återställer alla ops_tasks som arkiverades i migrationen
-- 20260901_ops_task_completion (Pipeline + Personliga tasks).
--
-- Data raderades ALDRIG — bara archived_at sattes för att dölja från UI.
-- Denna migration nollar archived_at så raderna dyker upp igen i Actionlistan.
-- Section-fältet behålls (PIPELINE / PERSONAL) för historik, men frontend
-- filtrerar inte längre på section så alla visas i samma lista.
--
-- Idempotent: rader utan archived_at påverkas inte.

UPDATE "ops_tasks"
   SET "archived_at" = NULL,
       "updated_at"  = COALESCE("updated_at", CURRENT_TIMESTAMP)
 WHERE "section" IN ('PIPELINE', 'PERSONAL')
   AND "archived_at" IS NOT NULL
   AND "deleted_at" IS NULL;
