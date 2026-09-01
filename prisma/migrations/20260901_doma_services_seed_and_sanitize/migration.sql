-- Doma Services AB — ny arbetsgivare för ALLA nya anställningsavtal.
-- Ersätter Stodona Services AB som default på mallarna. Idempotent.

-- 1. Skapa Doma Services AB (om det inte finns)
INSERT INTO "own_companies" ("name", "organization_number", "address", "postal_code", "city", "signatory_name", "signatory_email", "created_at", "updated_at")
SELECT 'Doma Services AB', '559999-0002', 'Sommarvägen 5', '171 54', 'Solna', 'Mikaela Wigert', 'mikaela.wigert@stodona.se', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "own_companies" WHERE "name" = 'Doma Services AB');

-- 2. Peka om ALLA anställningsmallar till Doma Services AB (som default)
UPDATE "contract_templates"
SET "own_company_id" = (SELECT id FROM "own_companies" WHERE "name" = 'Doma Services AB' LIMIT 1)
WHERE "category" IN ('ANSTALLNINGSAVTAL','PROVANSTALLNING','TILLSVIDAREANSTALLNING','VISSTIDSANSTALLNING','TIMANSTALLNING');

-- 3. SANERA legacy-mallar (Anställningsavtal — Tillsvidare, Provanställning (6 mån),
--    Visstidsanställning, Timanställning) från kollektivavtal-referenser och tvinga
--    in Årsarbetstid bredvid anställningsgraden.

-- 3a. Ta bort raden "Kollektivavtal: {{employment.collectiveAgreement}}" (med olika omkringliggande
--     markering) i alla mallars content.
UPDATE "contract_templates"
SET "content" = REPLACE("content", '<br/><strong>Kollektivavtal:</strong> {{employment.collectiveAgreement}}', '')
WHERE "content" LIKE '%<strong>Kollektivavtal:</strong> {{employment.collectiveAgreement}}%';

UPDATE "contract_templates"
SET "content" = REPLACE("content", '<strong>Kollektivavtal:</strong> {{employment.collectiveAgreement}}', '')
WHERE "content" LIKE '%<strong>Kollektivavtal:</strong> {{employment.collectiveAgreement}}%';

-- 3b. Tvinga "Årsarbetstid" bredvid "Anställningsgrad: X%" i alla legacy-mallar
UPDATE "contract_templates"
SET "content" = REPLACE(
  "content",
  '<strong>Anställningsgrad:</strong> {{employment.occupationPct}} %',
  '<strong>Anställningsgrad:</strong> {{employment.occupationPct}} % – Årsarbetstid'
)
WHERE "content" LIKE '%<strong>Anställningsgrad:</strong> {{employment.occupationPct}} %'
  AND "content" NOT LIKE '%<strong>Anställningsgrad:</strong> {{employment.occupationPct}} % – Årsarbetstid%';

-- 3c. Ta bort "OB-tillägg enligt kollektivavtal", "Övertid enligt kollektivavtal" mm i tim-mallen
UPDATE "contract_templates"
SET "content" = REPLACE(
  "content",
  'Semesterersättning 12 % och OB-tillägg utgår enligt kollektivavtal.',
  'Semesterersättning 12 % ingår i timlönen. OB-tillägg utgår enligt Doma Services interna regler.'
)
WHERE "content" LIKE '%OB-tillägg utgår enligt kollektivavtal%';

-- 3d. Alla övriga "enligt kollektivavtal"-fraser i legacy → "enligt Doma Services interna regler"
UPDATE "contract_templates"
SET "content" = REPLACE("content", 'enligt kollektivavtal', 'enligt Doma Services interna regler')
WHERE "content" LIKE '%enligt kollektivavtal%';

UPDATE "contract_templates"
SET "content" = REPLACE("content", 'inom lag och kollektivavtal', 'inom gällande lag')
WHERE "content" LIKE '%inom lag och kollektivavtal%';

UPDATE "contract_templates"
SET "content" = REPLACE("content", 'lag, kollektivavtal och', 'lag och')
WHERE "content" LIKE '%lag, kollektivavtal och%';

-- 4. Byt bolagsinfo i Stodona Standard-mallens data-substitution.
--    Mallen använder {{company.name}} som automatiskt fylls från ownCompanyId,
--    så inget innehåll behöver ändras — bara ownCompanyId ovanpå.
