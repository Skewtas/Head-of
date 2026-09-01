-- Reversal: Doma Services AB skulle INTE ha varit ny arbetsgivare.
-- Stodona Services AB är korrekt.
-- Peka om ALLA anställningsmallar tillbaka till Stodona Services AB.
-- Doma Services AB-raden får ligga kvar (harmlös), men används inte som
-- default för nya avtal.

UPDATE "contract_templates"
SET "own_company_id" = (SELECT id FROM "own_companies" WHERE "name" = 'Stodona Services AB' LIMIT 1)
WHERE "category" IN ('ANSTALLNINGSAVTAL','PROVANSTALLNING','TILLSVIDAREANSTALLNING','VISSTIDSANSTALLNING','TIMANSTALLNING')
  AND EXISTS (SELECT 1 FROM "own_companies" WHERE "name" = 'Stodona Services AB');
