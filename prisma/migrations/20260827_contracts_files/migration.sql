-- Fas 2 — filuppladdning
-- Idempotent
CREATE TABLE IF NOT EXISTS "contract_files" (
  "id" TEXT PRIMARY KEY,
  "mime" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "contract_attachments"
  ADD COLUMN IF NOT EXISTS "file_id" TEXT REFERENCES "contract_files"("id") ON DELETE SET NULL;

-- Seeda Stodona AB som första OwnCompany om det saknas
INSERT INTO "own_companies" ("name", "organization_number", "created_at", "updated_at")
SELECT 'Stodona AB', '559999-0001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "own_companies");
