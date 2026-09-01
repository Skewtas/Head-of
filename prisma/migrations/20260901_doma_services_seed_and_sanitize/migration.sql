-- NO-OP: Denna migration skulle ha skapat "Doma Services AB" som ny
-- arbetsgivare men det var fel bolagsnamn. Korrekt bolag är
-- "Stodona Services AB" som redan finns. Se följande migration
-- 20260901_revert_to_stodona_services som pekar om mallarna korrekt.
--
-- Sanerings-delen (ta bort kollektivavtal, tvinga Årsarbetstid)
-- görs i migration 20260901_sanitize_legacy_templates.
SELECT 1;
