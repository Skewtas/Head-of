-- Stodona Standard — Anställningsavtal (Fas 3, mall v1)
-- Idempotent: hoppar över om namnet redan finns.
INSERT INTO "contract_templates" ("name", "category", "own_company_id", "content", "variables", "version", "created_at", "updated_at")
SELECT
  'Stodona Standard — Anställningsavtal',
  'ANSTALLNINGSAVTAL',
  (SELECT id FROM own_companies WHERE name = 'Stodona Services AB' LIMIT 1),
$CONTENT$<div style="font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:#1a1a2e;line-height:1.65;max-width:720px;margin:0 auto;padding:0 8px;font-size:14px;">

<div style="text-align:center;padding:24px 0 32px;border-bottom:1px solid #eae4d9;">
  <div style="font-family:'Playfair Display',Georgia,serif;font-size:36px;font-weight:500;letter-spacing:-0.01em;">Anställningsavtal</div>
  <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;font-style:italic;color:#a68a4e;margin-top:6px;">{{employment.employment_form_label}}</div>
  <div style="font-size:11px;letter-spacing:0.12em;color:#8b8578;text-transform:uppercase;margin-top:16px;">Stodona Standard · v1</div>
</div>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">1. Parter</h2>
<p><strong>Arbetsgivare:</strong> {{company.name}}, org.nr {{company.organization_number}}. Adress: {{company.address}}.</p>
<p><strong>Arbetstagare:</strong> {{employee.first_name}} {{employee.last_name}}, personnr {{employee.personal_number}}. Adress: {{employee.address}}. E-post: {{employee.email}}. Telefon: {{employee.phone}}.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">2. Anställning</h2>
<p>Mellan {{company.name}} (nedan "Arbetsgivaren") och {{employee.first_name}} {{employee.last_name}} (nedan "Arbetstagaren") träffas följande anställningsavtal.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">3. Anställningsform</h2>
{{employment.form_paragraph}}

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">4. Befattning och arbetsuppgifter</h2>
<p><strong>Befattning:</strong> {{employment.job_title}}.</p>
<p>Arbetsgivaren har rätt att inom ramen för anställningen och Arbetstagarens arbetsskyldighet tilldela andra skäliga arbetsuppgifter. Exempel: arbete hos andra kunder, kontorsarbete, kvalitetskontroller, materialhantering, introduktion av kollegor, utbildning, administrativa uppgifter eller andra verksamhetsrelaterade uppgifter. Arbetsuppgifterna kan förändras över tid.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">5. Sysselsättningsgrad</h2>
<p>Arbetstagaren är anställd på <strong>{{employment.percentage}} %</strong> av heltid. Sysselsättningsgraden är kopplad till Stodonas system med årsarbetstid enligt § 6.</p>
<p>Detta innebär att Arbetstagaren är garanterad arbete och lön motsvarande sin avtalade sysselsättningsgrad i genomsnitt över den relevanta beräkningsperioden. Arbetstiden kan variera mellan olika veckor och månader — vissa perioder innebär mer arbete än genomsnittet, andra perioder mindre. Sådan variation kan bero på hög- eller lågsäsong, kundernas behov, beläggning och verksamhetens behov, och innebär inte i sig att sysselsättningsgraden ändras.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">6. Årsarbetstid</h2>
<p>Stodona tillämpar årsarbetstid. Den avtalade sysselsättningsgraden gäller över tid och bedöms inte isolerat utifrån en enskild vecka eller månad. Arbetstiden kan fördelas olika under året, och Arbetsgivaren får planera arbetstiden utifrån verksamhetens behov inom ramen för lag, kollektivavtal och detta avtal.</p>
<p>Om Arbetstagaren saknar kunduppdrag under delar av dagen innebär detta inte automatiskt ledighet. Arbetsgivaren kan tilldela andra arbetsuppgifter inom ramen för arbetsskyldigheten — annat kunduppdrag, arbete på kontoret, materialhantering, kvalitetsarbete, utbildning, introduktion, administrativa uppgifter eller andra skäliga arbetsuppgifter inom verksamheten.</p>
<p>Arbetstagaren ska stå till Arbetsgivarens förfogande motsvarande sin avtalade sysselsättningsgrad.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">7. Arbetstid och schemaläggning</h2>
<p>Arbetstidens förläggning bestäms av Arbetsgivaren inom ramen för lag, kollektivavtal och detta avtal. Schemat styrs bland annat av kundernas behov och verksamhetens beläggning.</p>
<p>Arbetstagaren ansvarar för att hålla sig uppdaterad om sitt schema och ska följa Arbetsgivarens schemaläggningsrutiner. En kundavbokning eller en lucka i schemat innebär inte automatiskt ledighet. Arbetstagaren får inte på eget initiativ avsluta arbetsdagen tidigare eller betrakta en lucka som ledighet utan godkännande från Arbetsgivaren. Om ett kunduppdrag ställs in kan Arbetsgivaren tilldela annat arbete.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">8. Restid och kundtid</h2>
<p><strong>Resa till och från arbetet.</strong> Vanlig resa mellan Arbetstagarens bostad och platsen där arbetsdagen börjar, samt resan från platsen där arbetsdagen avslutas tillbaka till bostaden, utgör som huvudregel inte arbetstid. Detta gäller med förbehåll för tvingande lag, eventuellt kollektivavtal och tillämplig rättspraxis.</p>
<p><strong>Resor mellan kunder.</strong> Arbetstagaren kan behöva resa mellan olika kunder under arbetsdagen. Hur sådan restid behandlas som arbetstid och/eller ersättningsgrundande tid styrs av tillämplig lag, kollektivavtal och Arbetsgivarens arbetstids- och ersättningsregler. Restid mellan kunder är inte automatiskt samma sak som produktiv kundtid eller debiterbar tid.</p>
<p><strong>Kundtid.</strong> Med kundtid avses den tid då Arbetstagaren utför arbete hos kund eller utför annat arbete som Arbetsgivaren uttryckligen har tilldelat.</p>
<p><strong>Rapportering.</strong> Arbetstagaren ska rapportera kundtid, restid, raster, frånvaro och andra relevanta tider enligt Arbetsgivarens rutiner och tidrapporteringssystem.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">9. Arbetsplats</h2>
<p>Arbetet utförs huvudsakligen hos Arbetsgivarens kunder inom <strong>{{employment.work_area}}</strong>, samt vid behov på Arbetsgivarens kontor eller annan plats som Arbetsgivaren anvisar inom ramen för anställningen.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">10. Lön och löneutbetalning</h2>
<p>{{employment.salary_paragraph}}</p>
<p>Lönen betalas i efterskott. Ordinarie löneutbetalningsdag är den 25:e varje månad. Om den 25:e inte är en bankdag sker utbetalning enligt Arbetsgivarens gällande lönerutin i anslutning till ordinarie löneutbetalningsdag.</p>
<p>Arbetstagaren ansvarar för korrekt tidrapportering. Frånvaro och andra uppgifter som påverkar lönen ska rapporteras inom de tidsfrister Arbetsgivaren anger.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">11. Semester</h2>
<p>Arbetstagaren har rätt till <strong>25 semesterdagar per semesterår</strong> enligt semesterlagen och eventuellt tillämpligt kollektivavtal.</p>
<p>Semesterlagen skiljer mellan rätt till semesterledighet och rätt till betald semester. Antalet betalda semesterdagar beror på vad Arbetstagaren har tjänat in enligt tillämpliga regler.</p>
<p>Semester ska ansökas om i förväg och godkännas enligt Arbetsgivarens rutiner. Vid semesterplanering tas hänsyn till verksamhetens behov.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">12. Frånvaro</h2>
<p>Sjukdom, vård av barn (VAB), semester, tjänstledighet och annan frånvaro ska anmälas enligt Arbetsgivarens rutiner. Arbetstagaren ansvarar för att frånvarotypen och omfattningen är korrekt och att informationen lämnas i tid.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">13. Lojalitetsplikt</h2>
<p>Arbetstagaren ska agera lojalt mot Arbetsgivaren. Under pågående anställning får Arbetstagaren inte bedriva konkurrerande verksamhet, hjälpa konkurrerande verksamhet på ett sätt som strider mot lojalitetsplikten, eller använda Stodonas kundrelationer eller företagsinformation för egen eller annans vinning på ett otillåtet sätt. Klausulen tillämpas i den omfattning som följer av svensk rätt.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">14. Sekretess</h2>
<p>Arbetstagaren förbinder sig att inte, vare sig under anställningen eller efter dess upphörande, obehörigen yppa eller för egen räkning använda information om Arbetsgivarens verksamhet som Arbetstagaren fått del av under anställningen. Sekretessen omfattar bland annat kundregister, kunduppgifter, adresser, kontaktuppgifter, priser, prislistor, kalkyler, marginaler, personalinformation, scheman, interna rutiner, affärsplaner, säljdata, tekniska system, lösenord, inloggningsuppgifter, företagshemligheter och annan konfidentiell information.</p>
<p>Sekretessen gäller både under anställningen och efter dess avslutande, i den omfattning som följer av lag och avtal. Stodonas kunder tillhör Arbetsgivarens affärsverksamhet. Kunduppgifter får endast användas för Arbetsgivarens verksamhet, får inte sparas privat eller användas för privata uppdrag, och Arbetstagaren får inte utan godkännande ta privata uppdrag från kunder som kommit i kontakt med Arbetstagaren genom Stodona.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">15. Värvningsförbud — kunder</h2>
<p>Under anställningen och under tolv (12) månader efter anställningens upphörande får Arbetstagaren inte, direkt eller indirekt, aktivt försöka förmå kunder som Arbetstagaren genom sin anställning haft kontakt med eller fått relevant kännedom om att:</p>
<ul>
  <li>säga upp sitt avtal med Stodona,</li>
  <li>minska sitt samarbete med Stodona,</li>
  <li>istället köpa tjänster direkt från Arbetstagaren,</li>
  <li>anlita ett företag där Arbetstagaren arbetar eller har ägarintresse,</li>
  <li>flytta affärsrelationen från Stodona till konkurrerande eller närstående verksamhet.</li>
</ul>
<p>Förbudet omfattar även indirekt värvning genom annan person eller annat företag. Klausulen avser aktiv värvning och tillämpas i den utsträckning som är tillåten enligt svensk rätt.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">16. Värvningsförbud — personal</h2>
<p>Under anställningen och under tolv (12) månader efter anställningens upphörande får Arbetstagaren inte, direkt eller indirekt, aktivt försöka förmå Stodonas anställda, konsulter eller uppdragstagare att lämna Stodona till förmån för Arbetstagaren själv, konkurrerande verksamhet, företag där Arbetstagaren arbetar eller har ägarintresse, eller närstående verksamhet.</p>
<p>Klausulen tillämpas i den utsträckning som är tillåten enligt svensk rätt.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">17. Arbetsgivarens egendom</h2>
<p>Nycklar, passerkort, arbetskläder, städmaterial, maskiner, telefoner, datorer, dokument, arbetsredskap och annan utrustning som Arbetsgivaren tillhandahåller ska hanteras omsorgsfullt. Egendomen tillhör Arbetsgivaren om inte annat uttryckligen avtalats och ska återlämnas vid Arbetsgivarens begäran eller senast vid anställningens avslutande.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">18. Nycklar och säkerhet</h2>
<p>Kundnycklar och passerkoder är särskilt skyddsvärda. De får aldrig lämnas till obehörig och får inte märkas på ett sätt som direkt identifierar kundens adress om detta strider mot Arbetsgivarens rutiner. Förlust ska rapporteras omedelbart. Arbetsgivarens säkerhetsrutiner ska alltid följas.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">19. Skuld och kvittning</h2>
<p>Arbetstagaren ska återbetala klar och förfallen skuld till Arbetsgivaren. Skuld kan avse felaktigt utbetald lön, löneförskott, ej återlämnad egendom eller andra dokumenterade fordringar.</p>
<p>Arbetstagaren medger kvittning i den utsträckning och på det sätt som är tillåtet enligt lagen (1970:215) om arbetsgivares kvittningsrätt och annan tillämplig lagstiftning.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">20. Skador och incidentrapportering</h2>
<p>Arbetstagaren ska arbeta omsorgsfullt och följa instruktioner för material och arbetsmetoder. Skador, incidenter eller risker ska rapporteras omedelbart till Arbetsgivaren. Arbetstagaren får inte försöka dölja en skada. Eventuellt personligt ansvar för skada avgörs enligt gällande lag.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">21. Policys och interna rutiner</h2>
<p>Arbetstagaren ska följa Arbetsgivarens vid var tid gällande personalhandbok, arbetsmiljörutiner, säkerhetsrutiner, tidrapporteringsrutiner, sjukanmälningsrutiner, kundrutiner, telefonpolicy, sekretesspolicy, IT-policy, kvalitetsrutiner och övriga skäliga instruktioner.</p>
<p>Privata telefonsamtal och privat användning av telefon under arbetstid ska begränsas och följa Arbetsgivarens policy. Akuta situationer hanteras rimligt.</p>
<p>Arbetsgivaren får uppdatera interna rutiner utan att detta automatiskt innebär att individuellt avtalade grundvillkor förändras.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">22. Anställningens upphörande</h2>
<p><strong>Uppsägningstid:</strong> {{employment.notice_period}}. Lag om anställningsskydd (LAS) och eventuellt kollektivavtal gäller där dessa regler är tvingande.</p>
<p>Vid anställningens upphörande ska Arbetstagaren återlämna samtliga nycklar, utrustning och arbetskläder, avsluta tillgång till Arbetsgivarens system och lämna över arbetsrelaterad information. Arbetstagaren får inte behålla kundregister eller företagsinformation.</p>
<p>Klausulerna om sekretess och värvningsförbud fortsätter att gälla enligt respektive klausul även efter anställningens upphörande.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">23. Tillämplig lag och kollektivavtal</h2>
<p>På detta avtal tillämpas svensk rätt. {{employment.collective_agreement_paragraph}}</p>
<p>Om någon bestämmelse i detta avtal skulle vara oförenlig med tvingande lag eller kollektivavtal ska bestämmelsen justeras i den omfattning som är nödvändig, medan övriga bestämmelser fortsätter att gälla oförändrat.</p>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;margin:32px 0 12px;border-bottom:1px solid #eae4d9;padding-bottom:6px;">24. Underskrift</h2>
<p>Detta avtal signeras elektroniskt med BankID via Stodonas signeringsflöde. Vid signering låses den slutliga avtalsversionen, en dokumenthash skapas, varje signerare verifieras, signeringstidpunkten registreras och en audit trail sparas. Slutgiltig signerad PDF och signeringsbevis levereras till båda parter och lagras i Stodonas avtalssystem.</p>

<table style="width:100%;margin-top:40px;">
  <tr>
    <td style="width:50%;vertical-align:top;padding-right:16px;">
      <p style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin:0 0 44px;">För Arbetsgivaren</p>
      <div style="border-top:1px solid #4b4a55;padding-top:8px;">
        <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:15px;">{{company.signatory_name}}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#8b8578;">Firmatecknare, {{company.name}}</p>
      </div>
    </td>
    <td style="width:50%;vertical-align:top;padding-left:16px;">
      <p style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin:0 0 44px;">Arbetstagare</p>
      <div style="border-top:1px solid #4b4a55;padding-top:8px;">
        <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:15px;">{{employee.first_name}} {{employee.last_name}}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#8b8578;">pnr {{employee.personal_number}}</p>
      </div>
    </td>
  </tr>
</table>

<div style="margin-top:48px;padding-top:16px;border-top:1px solid #eae4d9;text-align:center;font-size:10px;color:#8b8578;letter-spacing:0.08em;">
  STODONA STANDARD · ANSTÄLLNINGSAVTAL v1 · {{company.name}} · Datum {{today}}
</div>

</div>$CONTENT$,
  '{"required":["employee.first_name","employee.last_name","employment.job_title","employment.percentage","employment.start_date","employment.employment_form"],"derived":["employment.form_paragraph","employment.salary_paragraph","employment.collective_agreement_paragraph","employment.employment_form_label"]}'::jsonb,
  1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM contract_templates WHERE name = 'Stodona Standard — Anställningsavtal');

-- Arkivera de tidigare seed-mallarna så wizarden bara visar den nya
UPDATE "contract_templates" SET "archived_at" = CURRENT_TIMESTAMP
WHERE "name" IN ('Anställningsavtal — Tillsvidare','Provanställning (6 mån)','Visstidsanställning','Timanställning')
  AND "archived_at" IS NULL;
