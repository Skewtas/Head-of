-- Lägg till Stodona Services AB som eget bolag (för de flesta anställningsavtal)
INSERT INTO "own_companies" ("name", "organization_number", "created_at", "updated_at")
SELECT 'Stodona Services AB', '559999-0002', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "own_companies" WHERE "name" = 'Stodona Services AB');

-- Också: uppdatera default-mallarnas ownCompanyId till Stodona Services om
-- de fortfarande pekar på Stodona AB (vi vill att nya anställningsavtal
-- default är i Services). Bara för de 4 seedade mallarna.
UPDATE "contract_templates"
SET "own_company_id" = (SELECT id FROM own_companies WHERE name = 'Stodona Services AB' LIMIT 1)
WHERE "name" IN (
  'Anställningsavtal — Tillsvidare',
  'Provanställning (6 mån)',
  'Visstidsanställning',
  'Timanställning'
)
AND EXISTS (SELECT 1 FROM own_companies WHERE name = 'Stodona Services AB');
