-- Sanera legacy-mallar (Tillsvidare, Prov, Visstid, Timanställning):
-- 1. Ta bort ALLA "Kollektivavtal:"-rader
-- 2. Tvinga "Årsarbetstid" bredvid "Anställningsgrad: X%"
-- 3. Ersätt "enligt kollektivavtal" med "enligt Stodona Services interna regler"
-- Idempotent.

-- 1a. Med föregående <br/>
UPDATE "contract_templates"
SET "content" = REPLACE("content", '<br/><strong>Kollektivavtal:</strong> {{employment.collectiveAgreement}}', '')
WHERE "content" LIKE '%<strong>Kollektivavtal:</strong> {{employment.collectiveAgreement}}%';

-- 1b. Utan föregående <br/>
UPDATE "contract_templates"
SET "content" = REPLACE("content", '<strong>Kollektivavtal:</strong> {{employment.collectiveAgreement}}', '')
WHERE "content" LIKE '%<strong>Kollektivavtal:</strong> {{employment.collectiveAgreement}}%';

-- 2. Tvinga Årsarbetstid bredvid Anställningsgrad
UPDATE "contract_templates"
SET "content" = REPLACE(
  "content",
  '<strong>Anställningsgrad:</strong> {{employment.occupationPct}} %',
  '<strong>Anställningsgrad:</strong> {{employment.occupationPct}} % – Årsarbetstid'
)
WHERE "content" LIKE '%<strong>Anställningsgrad:</strong> {{employment.occupationPct}} %'
  AND "content" NOT LIKE '%<strong>Anställningsgrad:</strong> {{employment.occupationPct}} % – Årsarbetstid%';

-- 3. Ersätt "enligt kollektivavtal"-fraser
UPDATE "contract_templates"
SET "content" = REPLACE(
  "content",
  'Semesterersättning 12 % och OB-tillägg utgår enligt kollektivavtal.',
  'Semesterersättning 12 % ingår i timlönen. OB-tillägg utgår enligt Stodona Services interna regler.'
)
WHERE "content" LIKE '%OB-tillägg utgår enligt kollektivavtal%';

UPDATE "contract_templates"
SET "content" = REPLACE("content", 'enligt kollektivavtal', 'enligt Stodona Services interna regler')
WHERE "content" LIKE '%enligt kollektivavtal%';

UPDATE "contract_templates"
SET "content" = REPLACE("content", 'inom lag och kollektivavtal', 'inom gällande lag')
WHERE "content" LIKE '%inom lag och kollektivavtal%';

UPDATE "contract_templates"
SET "content" = REPLACE("content", 'lag, kollektivavtal och', 'lag och')
WHERE "content" LIKE '%lag, kollektivavtal och%';
