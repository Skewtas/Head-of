-- Uppdatera Stodona Services AB med riktig adress + firmatecknare
UPDATE "own_companies"
SET
  "address" = 'Sommarvägen 5',
  "postal_code" = '171 54',
  "city" = 'Solna',
  "signatory_name" = 'Mikaela Wigert',
  "signatory_email" = 'mikaela.wigert@stodona.se',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "name" = 'Stodona Services AB';

-- Även Stodona AB (samma kontor)
UPDATE "own_companies"
SET
  "address" = 'Sommarvägen 5',
  "postal_code" = '171 54',
  "city" = 'Solna',
  "signatory_name" = 'Mikaela Wigert',
  "signatory_email" = 'mikaela.wigert@stodona.se',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "name" = 'Stodona AB';
