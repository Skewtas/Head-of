-- Rätta organisationsnummer på Stodona-bolagen enligt Fortnox-registret.
-- Regler (Mikaela 2026-09-01):
--   Stodona Services AB  →  559481-1332
--   Stodona AB           →  559201-1059
--
-- Bolagsnamn och orgnr ska vara hårt sammankopplade så fel kombination
-- inte kan sparas. Idempotent.

-- 1. Rätta Stodona Services AB (hade fel orgnr 559999-0002 sedan seed)
UPDATE "own_companies"
   SET "organization_number" = '559481-1332',
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "name" = 'Stodona Services AB'
   AND "organization_number" <> '559481-1332';

-- 2. Skapa/uppdatera Stodona AB med rätt orgnr
INSERT INTO "own_companies" ("name", "organization_number", "address", "postal_code", "city", "signatory_name", "signatory_email", "created_at", "updated_at")
SELECT 'Stodona AB', '559201-1059', 'Sommarvägen 5', '171 54', 'Solna', 'Mikaela Wigert', 'mikaela.wigert@stodona.se', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "own_companies" WHERE "name" = 'Stodona AB');

UPDATE "own_companies"
   SET "organization_number" = '559201-1059',
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "name" = 'Stodona AB'
   AND "organization_number" <> '559201-1059';

-- 3. Ta bort Doma-krock om det behövs (harmlös rad, kan städas bort)
DELETE FROM "own_companies"
 WHERE "name" = 'Doma Services AB'
   AND "organization_number" = 'DOMA-DEPRECATED';
