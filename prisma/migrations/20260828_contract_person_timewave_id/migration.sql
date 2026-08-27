-- Direktkoppling till Timewave-employee (Prisma Employee-tabellen är ofta tom
-- eftersom personal-datan hämtas live från Timewave)
ALTER TABLE "contract_persons"
  ADD COLUMN IF NOT EXISTS "timewave_employee_id" INTEGER;

CREATE INDEX IF NOT EXISTS "contract_persons_timewave_idx"
  ON "contract_persons"("timewave_employee_id");
