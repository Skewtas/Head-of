-- Stodona Standard v10 — "Årsarbetstid" flyttas till samma rad som Anställningsgrad.
-- Regel (Mikaela 2026-09-01): "Årsarbetstid" ska ALLTID stå bredvid anställningsgraden
-- så det är omöjligt att missa. Det räcker inte att förklaringen finns någon annanstans.
--
-- Idempotent: två REPLACE-anrop mot content-fältet på Stodona Standard-mallen.
-- Om texterna redan är utbytta blir REPLACE en no-op.

-- 1. Ersätt sysselsättningsgrad-raden så label + värde innehåller "Årsarbetstid".
UPDATE "contract_templates"
SET "content" = REPLACE(
  "content",
  '<div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Sysselsättningsgrad<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Employment percentage</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:700;">{{employment.percentage}} % <span style="font-weight:500;">av heltid</span><span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;"><strong>{{employment.percentage}} %</strong> of full-time</span></div>',
  '<div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Anställningsgrad — Årsarbetstid<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Employment percentage — Annual working hours</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:700;">{{employment.percentage}} % <span style="font-weight:500;">av heltid</span> — <span style="color:#a68a4e;font-weight:700;">Årsarbetstid</span><span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;"><strong>{{employment.percentage}} %</strong> of full-time — Annual working hours</span></div>'
)
WHERE "name" = 'Stodona Standard';

-- 2. Ta bort den separata Årsarbetstid-raden (informationen finns nu inbakad ovan
--    plus i en förklaringsruta nedanför Anställningen-blocket, se nedan).
UPDATE "contract_templates"
SET "content" = REPLACE(
  "content",
  '<div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Årsarbetstid<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Annual working hours</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Tillämpas — sysselsättningsgraden gäller i genomsnitt över perioden och kan variera vecka till vecka<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">Applied — percentage averaged over the period, may vary week to week</span></div>
    </div>
    ',
  ''
)
WHERE "name" = 'Stodona Standard';

-- 3. Lägg till en Om Årsarbetstid-förklaringsruta direkt EFTER Anställningen-fakta-blocket.
--    Insertar bara om den inte redan finns (idempotent).
UPDATE "contract_templates"
SET "content" = REPLACE(
  "content",
  '<div style="padding:20px 24px;background:#faf7ee;border-left:3px solid #c9a96e;">',
  '<div style="padding:20px 24px;background:#faf7ee;border-left:3px solid #c9a96e;" data-block="anstallningen-facts">'
)
WHERE "name" = 'Stodona Standard'
  AND "content" NOT LIKE '%data-block="anstallningen-facts"%';

-- 4. Efter Anställningen-blocket, lägg förklaringen (bara om den inte redan finns).
UPDATE "contract_templates"
SET "content" = REPLACE(
  "content",
  '<div style="padding:20px 24px;background:#faf7ee;border-left:3px solid #c9a96e;" data-block="anstallningen-facts">',
  '<div style="padding:20px 24px;background:#faf7ee;border-left:3px solid #c9a96e;" data-block="anstallningen-facts"><div style="padding:14px 0 8px;margin:0 0 12px;border-bottom:1px dashed #d8cfbc;font-size:12.5px;color:#4b4a55;line-height:1.55;"><span style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#a68a4e;font-weight:700;display:block;margin-bottom:4px;">Om årsarbetstid<span style="color:#8b8578;font-weight:500;text-transform:none;font-style:italic;letter-spacing:0;"> / About annual working hours</span></span>Anställningen tillämpar årsarbetstid. Anställningsgraden anger genomsnittlig sysselsättning över perioden — antalet timmar per vecka kan variera men balanseras över året.<span style="display:block;color:#8b8578;font-style:italic;margin-top:3px;">Annual working hours apply. The employment percentage represents average work over the period — weekly hours may vary but balance out over the year.</span></div>'
)
WHERE "name" = 'Stodona Standard'
  AND "content" NOT LIKE '%Om årsarbetstid%';
