-- Uppdatera Stodona Standard-mallen till v4:
-- * Punktlistor (kort text)
-- * OB-tillägg + övertidsersättning
-- * Ny § Extra intjäning (provisioner)
-- * Riktig logga från stodona.se
-- * § Tillämplig lag och kollektivavtal borttagen
UPDATE "contract_templates"
SET
  "content" = $C$<div style="font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:#1a1a2e;line-height:1.55;max-width:720px;margin:0 auto;padding:0 8px;font-size:14px;">

<div style="padding:36px 0 22px;border-bottom:2px solid #1a1a2e;display:flex;justify-content:space-between;align-items:flex-start;gap:20px;">
  <img src="https://stodona.se/logotyp.png" alt="Stodona" style="height:44px;width:auto;display:block;" />
  <div style="text-align:right;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#8b8578;font-weight:600;line-height:1.6;">Anställningsavtal<div style="color:#4b4a55;font-family:monospace;font-size:11px;letter-spacing:0;text-transform:none;margin-top:4px;">Stodona Standard · v4</div></div>
</div>

<div style="padding:40px 0 40px;text-align:center;border-bottom:1px solid #eae4d9;">
  <h1 style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:42px;font-weight:500;letter-spacing:-0.02em;line-height:1.05;">Anställningsavtal</h1>
  <div style="margin-top:12px;font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:19px;color:#a68a4e;">{{employment.employment_form_label}}</div>
  <div style="width:40px;height:2px;background:#c9a96e;margin:20px auto 0;"></div>
</div>

<div style="padding:32px 0 4px;display:grid;grid-template-columns:1fr 1fr;gap:0;">
  <div style="padding:20px 22px;background:#faf7ee;border:1px solid #eae4d9;">
    <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:8px;">Arbetsgivare</div>
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:19px;color:#1a1a2e;margin-bottom:3px;">{{company.name}}</div>
    <div style="font-family:monospace;font-size:11px;color:#4b4a55;margin-bottom:12px;">{{company.organization_number}}</div>
    <div style="font-size:12px;color:#4b4a55;line-height:1.5;">{{company.address}}</div>
  </div>
  <div style="padding:20px 22px;background:#faf7ee;border:1px solid #eae4d9;border-left:none;">
    <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:8px;">Arbetstagare</div>
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:19px;color:#1a1a2e;margin-bottom:3px;">{{employee.first_name}} {{employee.last_name}}</div>
    <div style="font-family:monospace;font-size:11px;color:#4b4a55;margin-bottom:12px;">{{employee.personal_number}}</div>
    <div style="font-size:12px;color:#4b4a55;line-height:1.5;">{{employee.address}}<br>{{employee.email}} · {{employee.phone}}</div>
  </div>
</div>

<div style="padding:24px 0 8px;">

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§1 Anställningsform</h2>
{{employment.form_paragraph}}

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§2 Befattning</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Befattning: <strong style="color:#1a1a2e;">{{employment.job_title}}</strong></li>
  <li>Arbetsgivaren får tilldela andra skäliga arbetsuppgifter inom arbetsskyldigheten</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§3 Sysselsättningsgrad</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li><strong style="color:#1a1a2e;">{{employment.percentage}} % av heltid</strong></li>
  <li>Gäller i genomsnitt över beräkningsperioden — kan variera vecka till vecka</li>
  <li>Variation ändrar inte sysselsättningsgraden</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§4 Årsarbetstid</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Stodona tillämpar årsarbetstid</li>
  <li>Arbetsgivaren planerar arbetstiden utifrån verksamhetens behov</li>
  <li>Ingen kundbokning ≠ ledighet — Arbetsgivaren kan tilldela annat arbete</li>
  <li>Arbetstagaren står till förfogande motsvarande sin sysselsättningsgrad</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§5 Schema</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Arbetsgivaren bestämmer schemat inom lag och kollektivavtal</li>
  <li>Arbetstagaren följer schemat och håller sig uppdaterad</li>
  <li>Kundavbokning eller lucka ≠ ledighet</li>
  <li>Arbetsdagen får inte avslutas tidigare utan godkännande</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§6 Restid och kundtid</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li><strong style="color:#1a1a2e;">Resa hem–arbete:</strong> ej arbetstid (huvudregel, förbehåll för tvingande lag)</li>
  <li><strong style="color:#1a1a2e;">Restid mellan kunder:</strong> hanteras enligt lag, kollektivavtal och Arbetsgivarens regler — inte automatiskt produktiv tid</li>
  <li><strong style="color:#1a1a2e;">Kundtid:</strong> tid hos kund eller annat tilldelat arbete</li>
  <li>Rapportering sker via Arbetsgivarens tidsystem</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§7 Arbetsplats</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Huvudsakligen hos Arbetsgivarens kunder inom <strong style="color:#1a1a2e;">{{employment.work_area}}</strong></li>
  <li>Vid behov på Arbetsgivarens kontor eller annan anvisad plats</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§8 Lön och löneutbetalning</h2>
{{employment.salary_paragraph}}
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Utbetalning den <strong style="color:#1a1a2e;">25:e varje månad</strong>, i efterskott</li>
  <li>OB-tillägg (kväll, helg, storhelg) utgår enligt kollektivavtal</li>
  <li>Övertidsersättning enligt kollektivavtal</li>
  <li>Arbetstagaren ansvarar för korrekt tidrapportering inom tidsfrister</li>
</ul>

<div style="background:#f6ebd4;padding:18px 22px;margin:16px 0 0;border-radius:8px;border:1px solid #d8cfbc;">
  <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:0 0 8px;">§9 Extra intjäning</h2>
  <p style="margin:0 0 8px;font-size:13.5px;color:#4b4a55;">Utöver ordinarie lön kan Arbetstagaren tjäna extra genom att bidra till Stodonas tillväxt:</p>
  <ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
    <li>Rekommendera <strong style="color:#1a1a2e;">fönsterputs, storstädning eller andra tilläggstjänster</strong> till befintlig kund → provision vid genomförd bokning</li>
    <li>Värva ny kund (vän, bekant, granne) → <strong style="color:#1a1a2e;">rabatt till kunden</strong> och rekommendationsersättning till Arbetstagaren</li>
    <li>Provisions- och rabattnivåer framgår av Personalprovisions-policyn i personalhandboken</li>
    <li>Rekommendationer registreras i Arbetsgivarens system</li>
  </ul>
</div>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§10 Semester</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li><strong style="color:#1a1a2e;">25 semesterdagar per semesterår</strong> enligt semesterlagen</li>
  <li>Antal betalda dagar beror på intjänande</li>
  <li>Ansöks i förväg, godkänns med hänsyn till verksamhetens behov</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§11 Frånvaro</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Sjukdom, VAB, semester, tjänstledighet och annan frånvaro anmäls enligt Arbetsgivarens rutiner</li>
  <li>Arbetstagaren ansvarar för att uppgifterna är korrekta och lämnas i tid</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§12 Lojalitetsplikt</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Arbetstagaren ska agera lojalt mot Arbetsgivaren</li>
  <li>Ingen konkurrerande verksamhet under anställningen</li>
  <li>Stodonas kundrelationer får inte användas otillbörligt</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§13 Sekretess</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Konfidentiell information får inte yppas eller användas obehörigen — under eller efter anställningen</li>
  <li>Omfattar bl.a. kunduppgifter, priser, kalkyler, scheman, personal, IT-system, lösenord, företagshemligheter</li>
  <li>Inga privata uppdrag från Stodona-kunder utan godkännande</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§14 Värvningsförbud — kunder</h2>
<p style="margin:6px 0 6px;font-size:13.5px;color:#4b4a55;">Under anställningen och <strong style="color:#1a1a2e;">12 månader efter dess upphörande</strong> får Arbetstagaren inte, direkt eller indirekt, aktivt värva Stodonas kunder att:</p>
<ul style="margin:0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>säga upp eller minska sitt samarbete med Stodona</li>
  <li>flytta affärsrelationen till Arbetstagaren eller närstående verksamhet</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§15 Värvningsförbud — personal</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Under anställningen + 12 månader efter dess upphörande</li>
  <li>Ingen aktiv värvning av Stodonas anställda, konsulter eller uppdragstagare till Arbetstagaren eller närstående verksamhet</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§16 Arbetsgivarens egendom</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Nycklar, passerkort, arbetskläder, städmaterial, telefoner, datorer m.m. tillhör Arbetsgivaren</li>
  <li>Hanteras omsorgsfullt, återlämnas vid begäran eller vid anställningens upphörande</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§17 Nycklar och säkerhet</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Kundnycklar och passerkoder får aldrig lämnas till obehörig</li>
  <li>Får inte märkas så kundens adress kan identifieras</li>
  <li>Förlust rapporteras omedelbart</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§18 Skuld och kvittning</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Skuld till Arbetsgivaren återbetalas</li>
  <li>Kvittning från lön endast enligt lagen (1970:215) om arbetsgivares kvittningsrätt</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§19 Skador och incidentrapportering</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Arbetstagaren arbetar omsorgsfullt</li>
  <li>Skador, incidenter och risker rapporteras omedelbart — får inte döljas</li>
  <li>Personligt ansvar avgörs enligt lag</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§20 Policys och interna rutiner</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Arbetstagaren följer Arbetsgivarens personalhandbok, arbetsmiljö-, säkerhets-, tidrapporterings-, sjukanmälnings-, IT-, sekretess- och kvalitetsrutiner</li>
  <li>Arbetsgivaren får uppdatera rutinerna — individuellt avtalade grundvillkor förändras inte</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§21 Anställningens upphörande</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Uppsägningstid enligt LAS</li>
  <li>Vid avslut: nycklar, utrustning och kläder återlämnas, systemåtkomst avslutas</li>
  <li>Kundregister och företagsinformation får inte behållas</li>
  <li>Sekretess- och värvningsklausulerna gäller även efter avslut</li>
</ul>

<h2 style="font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;margin:16px 0 8px;padding-top:16px;border-top:1px solid #eae4d9;">§22 Underskrift</h2>
<ul style="margin:6px 0 0;padding-left:22px;font-size:13.5px;color:#4b4a55;">
  <li>Avtalet signeras elektroniskt med BankID via Stodonas signeringsflöde</li>
  <li>Vid signering låses avtalsversionen, dokumenthash och audit trail skapas</li>
  <li>Signerad PDF lagras i Stodonas avtalssystem</li>
</ul>

</div>

<div style="padding:40px 0 36px;margin-top:20px;background:#faf7ee;border-top:2px solid #1a1a2e;padding-left:32px;padding-right:32px;">
  <h3 style="font-family:'Playfair Display',Georgia,serif;font-size:23px;font-weight:500;color:#1a1a2e;margin:0 0 6px;">Signaturer</h3>
  <p style="font-size:12.5px;color:#4b4a55;margin:0 0 26px;line-height:1.55;">Genom elektronisk signering nedan bekräftar parterna att de tagit del av och godkänner samtliga villkor.</p>
  <table style="width:100%;">
    <tr>
      <td style="width:50%;vertical-align:top;padding-right:16px;">
        <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:22px;">För Arbetsgivaren</div>
        <div style="height:1px;background:#4b4a55;margin-top:44px;margin-bottom:8px;"></div>
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:#1a1a2e;margin-bottom:3px;">{{company.signatory_name}}</div>
        <div style="font-size:11.5px;color:#8b8578;line-height:1.5;">Firmatecknare, {{company.name}}</div>
      </td>
      <td style="width:50%;vertical-align:top;padding-left:16px;">
        <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:22px;">Arbetstagare</div>
        <div style="height:1px;background:#4b4a55;margin-top:44px;margin-bottom:8px;"></div>
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:#1a1a2e;margin-bottom:3px;">{{employee.first_name}} {{employee.last_name}}</div>
        <div style="font-size:11.5px;color:#8b8578;line-height:1.5;">Personnr {{employee.personal_number}}</div>
      </td>
    </tr>
  </table>
</div>

<div style="padding:18px 0;background:#1a1a2e;color:#cec7b8;font-size:10.5px;letter-spacing:0.08em;text-align:center;">
  <strong style="color:#f5f3ef;">{{company.name}}</strong> · {{company.address}} · Stodona Standard v4 · {{today}}
</div>

</div>$C$,
  "version" = 4,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "name" = 'Stodona Standard — Anställningsavtal';
