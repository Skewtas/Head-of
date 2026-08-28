-- Stodona Standard v9 — Årsarbetstid + Uppsägningstid in Anställningen-blocket, kollektivavtal borta
UPDATE "contract_templates"
SET "content" = $V9$<div style="font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:#1a1a2e;line-height:1.55;max-width:720px;margin:0 auto;padding:0 8px;font-size:14px;">

<div style="padding:36px 0 22px;border-bottom:2px solid #1a1a2e;display:flex;justify-content:space-between;align-items:flex-start;gap:20px;">
  <img src="https://stodona.se/logotyp.png" alt="Stodona" style="height:44px;width:auto;display:block;" />
  <div style="text-align:right;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#8b8578;font-weight:600;line-height:1.6;">Anställningsavtal<div style="color:#4b4a55;font-family:monospace;font-size:11px;letter-spacing:0;text-transform:none;margin-top:4px;">{{contract.number}}</div><div style="display:inline-block;margin-top:6px;padding:2px 7px;background:#faf7ee;color:#a68a4e;font-size:9.5px;font-weight:700;letter-spacing:0.14em;border-radius:3px;">SV / EN</div></div>
</div>

<div style="padding:40px 0 40px;text-align:center;border-bottom:1px solid #eae4d9;">
  <h1 style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:42px;font-weight:500;letter-spacing:-0.02em;line-height:1.05;">Anställningsavtal</h1>
  <div style="margin-top:6px;font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:22px;color:#8b8578;font-weight:400;">Employment Contract</div>
  <div style="margin-top:14px;font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:18px;color:#a68a4e;">{{employment.employment_form_label}} <span style="color:#8b8578;font-weight:400;">/ {{employment.employment_form_label_en}}</span></div>
  <div style="width:40px;height:2px;background:#c9a96e;margin:20px auto 0;"></div>
  <div style="margin:22px auto 0;max-width:480px;padding:12px 18px;background:#faf7ee;border:1px solid #d8cfbc;border-radius:8px;font-size:12px;color:#4b4a55;line-height:1.5;">
    Detta avtal är juridiskt bindande på svenska. Den engelska översättningen är en hjälp för förståelsen — vid tolkningsfråga gäller den svenska texten.<br/><span style="display:block;margin-top:4px;color:#8b8578;font-size:11.5px;font-style:italic;">This contract is legally binding in Swedish. The English translation is a reading aid — in case of ambiguity, the Swedish text prevails.</span>
  </div>
</div>

<div style="padding:32px 0 4px;display:grid;grid-template-columns:1fr 1fr;gap:0;">
  <div style="padding:20px 22px;background:#faf7ee;border:1px solid #eae4d9;">
    <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:8px;">Arbetsgivare <span style="color:#8b8578;font-weight:600;">/ Employer</span></div>
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:19px;color:#1a1a2e;margin-bottom:3px;">{{company.name}}</div>
    <div style="font-family:monospace;font-size:11px;color:#4b4a55;margin-bottom:12px;">{{company.organization_number}}</div>
    <div style="font-size:12px;color:#4b4a55;line-height:1.5;">{{company.address}}</div>
  </div>
  <div style="padding:20px 22px;background:#faf7ee;border:1px solid #eae4d9;border-left:none;">
    <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:8px;">Arbetstagare <span style="color:#8b8578;font-weight:600;">/ Employee</span></div>
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:19px;color:#1a1a2e;margin-bottom:3px;">{{employee.first_name}} {{employee.last_name}}</div>
    <div style="font-family:monospace;font-size:11px;color:#4b4a55;margin-bottom:12px;">{{employee.personal_number}}</div>
    <div style="font-size:12px;color:#4b4a55;line-height:1.5;">{{employee.address}}<br/>{{employee.email}} · {{employee.phone}}</div>
  </div>
</div>

<div style="padding:32px 0 8px;">

<div style="padding:22px 0 8px;">
  <h2 style="margin:0 0 12px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a1a2e;letter-spacing:-0.01em;">Anställningen<span style="margin-left:8px;font-style:italic;font-weight:400;color:#8b8578;font-size:17px;">/ Employment</span></h2>
  <div style="padding:20px 24px;background:#faf7ee;border-left:3px solid #c9a96e;">
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Anställningsnummer<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Employee number</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;font-family:monospace;">{{employment.employment_number}}</div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Anställningsform<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Type of employment</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">{{employment.employment_form_label}}<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;">{{employment.employment_form_label_en}}</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Tillträdesdag<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Start date</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:700;">{{employment.start_date}}</div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Befattning<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Job title</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">{{employment.job_title}}</div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Sysselsättningsgrad<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Employment percentage</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:700;">{{employment.percentage}} % <span style="font-weight:500;">av heltid</span><span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;"><strong>{{employment.percentage}} %</strong> of full-time</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Årsarbetstid<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Annual working hours</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Tillämpas — sysselsättningsgraden gäller i genomsnitt över perioden och kan variera vecka till vecka<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">Applied — percentage averaged over the period, may vary week to week</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Uppsägningstid<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Notice period</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;"><strong>2 veckor</strong> om Arbetsgivaren säger upp · <strong>4 veckor</strong> om du säger upp<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;"><strong>2 weeks</strong> if employer terminates · <strong>4 weeks</strong> if you terminate</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Arbetsområde<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Work area</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">{{employment.work_area}}<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">Work area shown above</span></div>
    </div>
  </div>
</div>

<div style="padding:22px 0 8px;border-top:1px solid #eae4d9;margin-top:8px;">
  <h2 style="margin:0 0 12px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a1a2e;letter-spacing:-0.01em;">Arbetstid och schema<span style="margin-left:8px;font-style:italic;font-weight:400;color:#8b8578;font-size:17px;">/ Working hours & schedule</span></h2>
  <div style="padding:20px 24px;background:#faf7ee;border-left:3px solid #c9a96e;">
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Schema<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Schedule</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Finns i Stodonas schemasystem — du håller dig uppdaterad själv<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">Available in Stodona's schedule system — you keep yourself updated</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Ingen bokning ≠ ledighet<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">No booking ≠ time off</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Annat arbete kan tilldelas — du står till förfogande<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">Other work may be assigned — you are on call</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Resa till/från arbete<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Commute to/from work</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Ingen ersättning — endast för arbetad tid<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">Not paid — only actual working hours are paid</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Tidrapportering<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Time reporting</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Du checkar in och ut från arbetsplatsen<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">You check in and out at the workplace</span></div>
    </div>
  </div>
</div>

<div style="padding:22px 0 8px;border-top:1px solid #eae4d9;margin-top:8px;">
  <h2 style="margin:0 0 12px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a1a2e;letter-spacing:-0.01em;">Lön och löneutbetalning<span style="margin-left:8px;font-style:italic;font-weight:400;color:#8b8578;font-size:17px;">/ Salary & payment</span></h2>
  <div style="padding:20px 24px;background:#faf7ee;border-left:3px solid #c9a96e;">
    {{employment.salary_row}}
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Utbetalningsdag<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Pay day</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Den <strong>25:e</strong> varje månad, i efterskott<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">The <strong>25th</strong> of each month, in arrears</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">OB-tillägg<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Inconvenient-hours bonus</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;"><strong>15 kr/h</strong> vardagar efter 18:30 · <strong>20 kr/h</strong> lördagar, söndagar och helgdagar<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;"><strong>15 kr/h</strong> weekdays after 18:30 · <strong>20 kr/h</strong> weekends and public holidays</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Övertidsersättning<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Overtime pay</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Enligt timlön<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">Per your hourly rate</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Bankkonto för lön<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Bank account for salary</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;font-family:monospace;">{{employment.bank_account}}</div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Tidrapportering<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Time reporting responsibility</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Du ansvarar för korrekt rapportering inom Arbetsgivarens tidsfrister<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">You are responsible for correct reporting within the employer's deadlines</span></div>
    </div>
  </div>

  <div style="background:#f6ebd4;padding:20px 24px;border-radius:8px;border:1px solid #d8cfbc;margin:16px 0 0;">
    <h3 style="margin:0 0 2px;font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:500;color:#1a1a2e;">Extra intjäning<span style="margin-left:8px;font-style:italic;font-weight:400;color:#8b8578;font-size:15px;">/ Extra earnings</span></h3>
    <p style="font-size:13px;color:#4b4a55;margin:6px 0 4px;">Utöver ordinarie lön kan du tjäna extra genom att bidra till Stodonas tillväxt:</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;margin:0 0 8px;">In addition to your regular salary, you can earn extra by helping Stodona grow:</p>
    <ul style="list-style:none;padding:0;margin:6px 0 0;">
      <li style="position:relative;padding:8px 0 8px 22px;font-size:13.5px;color:#4b4a55;line-height:1.55;">
        <span style="position:absolute;left:4px;top:15px;width:6px;height:6px;border-radius:50%;background:#a68a4e;display:block;"></span>
        Rekommendera <strong style="color:#1a1a2e;">fönsterputs, storstädning eller andra tilläggstjänster</strong> till befintlig kund → provision vid genomförd bokning
        <span style="display:block;color:#8b8578;font-style:italic;font-size:12px;margin-top:3px;">Recommend <strong>window cleaning, deep cleaning or other services</strong> to an existing customer → commission when the booking is completed</span>
      </li>
      <li style="position:relative;padding:8px 0 8px 22px;font-size:13.5px;color:#4b4a55;line-height:1.55;border-top:1px dashed rgba(215,190,140,0.5);">
        <span style="position:absolute;left:4px;top:15px;width:6px;height:6px;border-radius:50%;background:#a68a4e;display:block;"></span>
        Värva ny kund (vän, bekant, granne) → <strong style="color:#1a1a2e;">rabatt till kunden</strong> och rekommendationsersättning till dig
        <span style="display:block;color:#8b8578;font-style:italic;font-size:12px;margin-top:3px;">Refer a new customer (friend, family, neighbor) → <strong>discount for the customer</strong> and referral commission for you</span>
      </li>
      <li style="position:relative;padding:8px 0 8px 22px;font-size:13.5px;color:#4b4a55;line-height:1.55;border-top:1px dashed rgba(215,190,140,0.5);">
        <span style="position:absolute;left:4px;top:15px;width:6px;height:6px;border-radius:50%;background:#a68a4e;display:block;"></span>
        Provisions- och rabattnivåer framgår av Personalprovisions-policyn i personalhandboken
        <span style="display:block;color:#8b8578;font-style:italic;font-size:12px;margin-top:3px;">Commission and discount rates are in the Staff Commission policy in the employee handbook</span>
      </li>
      <li style="position:relative;padding:8px 0 8px 22px;font-size:13.5px;color:#4b4a55;line-height:1.55;border-top:1px dashed rgba(215,190,140,0.5);">
        <span style="position:absolute;left:4px;top:15px;width:6px;height:6px;border-radius:50%;background:#a68a4e;display:block;"></span>
        Rekommendationer registreras i Arbetsgivarens system
        <span style="display:block;color:#8b8578;font-style:italic;font-size:12px;margin-top:3px;">Referrals are registered in the employer's system</span>
      </li>
    </ul>
  </div>
</div>

<div style="padding:22px 0 8px;border-top:1px solid #eae4d9;margin-top:8px;">
  <h2 style="margin:0 0 12px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500;color:#1a1a2e;letter-spacing:-0.01em;">Semester och frånvaro<span style="margin-left:8px;font-style:italic;font-weight:400;color:#8b8578;font-size:17px;">/ Vacation & absence</span></h2>
  <div style="padding:20px 24px;background:#faf7ee;border-left:3px solid #c9a96e;">
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Semester<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Vacation</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;"><strong>25 dagar</strong> per semesterår enligt semesterlagen — antal betalda dagar beror på intjänande<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;"><strong>25 days</strong> per vacation year under Swedish law — paid days depend on accrual</span></div>
    </div>
    <div style="display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;border-top:1px solid #d8cfbc;">
      <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;">Frånvaro<span style="display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;">Absence</span></div>
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">Sjukdom, VAB, tjänstledighet m.m. anmäls enligt Arbetsgivarens rutiner<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;">Sick leave, VAB (care of children), leave etc. reported per employer's routine</span></div>
    </div>
  </div>
</div>

<div style="padding-top:8px;">

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§1</span>Lojalitetsplikt<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Duty of loyalty</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Arbetstagaren ska agera lojalt mot Arbetsgivaren. Ingen konkurrerande verksamhet under anställningen. Stodonas kundrelationer får inte användas otillbörligt.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">You shall act loyally toward the employer. No competing activity during employment. Stodona's customer relationships may not be used improperly.</p>
  </section>

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§2</span>Sekretess<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Confidentiality</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Konfidentiell information får inte yppas eller användas obehörigen — under eller efter anställningen. Omfattar bl.a. kunduppgifter, priser, kalkyler, scheman, personal, IT-system, lösenord och företagshemligheter. Inga privata uppdrag från Stodona-kunder utan godkännande.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">Confidential information may not be disclosed or used without authorization — during or after employment. Includes customer data, prices, calculations, schedules, staff, IT systems, passwords and trade secrets. No private assignments from Stodona customers without approval.</p>
  </section>

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§3</span>Värvningsförbud — kunder<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Non-solicitation — customers</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Under anställningen och <strong style="color:#1a1a2e;">12 månader efter dess upphörande</strong> får Arbetstagaren inte, direkt eller indirekt, aktivt värva Stodonas kunder att säga upp eller minska sitt samarbete med Stodona, eller flytta affärsrelationen till Arbetstagaren eller närstående verksamhet. Tillämpas enligt svensk rätt.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">During employment and for <strong>12 months after its end</strong>, you may not, directly or indirectly, actively solicit Stodona's customers to terminate or reduce their business with Stodona, or move the relationship to yourself or a related business. Applied per Swedish law.</p>
  </section>

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§4</span>Värvningsförbud — personal<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Non-solicitation — staff</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Under anställningen och 12 månader efter dess upphörande får Arbetstagaren inte, direkt eller indirekt, aktivt värva Stodonas anställda, konsulter eller uppdragstagare till Arbetstagaren eller närstående verksamhet.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">During employment and for 12 months after, you may not, directly or indirectly, actively recruit Stodona's employees, consultants or contractors to yourself or a related business.</p>
  </section>

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§5</span>Arbetsgivarens egendom, nycklar och säkerhet<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Employer property, keys & security</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Nycklar, passerkort, arbetskläder, städmaterial, telefoner, datorer m.m. tillhör Arbetsgivaren och återlämnas vid begäran eller vid anställningens upphörande. Kundnycklar och passerkoder får aldrig lämnas till obehörig och får inte märkas så kundens adress kan identifieras. Förlust rapporteras omedelbart.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">Keys, access cards, work clothes, cleaning supplies, phones, computers etc. belong to the employer and are returned on request or when employment ends. Customer keys and access codes must never be given to unauthorized persons and must not be marked so the customer's address can be identified. Loss is reported immediately.</p>
  </section>

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§6</span>Skuld och kvittning<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Debt & offset</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Skuld till Arbetsgivaren återbetalas. Kvittning från lön endast enligt lagen (1970:215) om arbetsgivares kvittningsrätt.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">Debt to the employer is repaid. Wage offset only per Swedish employer's right-of-offset law (1970:215).</p>
  </section>

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§7</span>Skador och incidentrapportering<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Damage & incident reporting</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Arbetstagaren arbetar omsorgsfullt. Skador, incidenter och risker rapporteras omedelbart — får inte döljas. Personligt ansvar avgörs enligt lag.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">You work carefully. Damage, incidents and risks are reported immediately — may not be hidden. Personal liability is determined by law.</p>
  </section>

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§8</span>Policys och interna rutiner<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Policies & procedures</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Arbetstagaren följer Arbetsgivarens personalhandbok, arbetsmiljö-, säkerhets-, tidrapporterings-, sjukanmälnings-, IT-, sekretess- och kvalitetsrutiner. Arbetsgivaren får uppdatera rutinerna — individuellt avtalade grundvillkor förändras inte.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">You follow the employer's staff handbook, workplace safety, security, time reporting, sick leave, IT, confidentiality and quality procedures. The employer may update procedures — individually agreed core terms remain unchanged.</p>
  </section>

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§9</span>Anställningens upphörande<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Termination</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Uppsägningstid: <strong style="color:#1a1a2e;">2 veckor</strong> om Arbetsgivaren säger upp Arbetstagaren, <strong style="color:#1a1a2e;">4 veckor</strong> om Arbetstagaren säger upp sig. Vid avslut återlämnas nycklar, utrustning och kläder, systemåtkomst avslutas och arbetsrelaterad information överlämnas. Kundregister och företagsinformation får inte behållas. Sekretess- och värvningsklausulerna gäller även efter avslut.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">Notice period: <strong>2 weeks</strong> if the employer terminates, <strong>4 weeks</strong> if the employee resigns. On termination: keys, equipment and clothing are returned, system access ended, and work information handed over. Customer records and company information may not be kept. Confidentiality and non-solicitation clauses continue to apply after termination.</p>
  </section>

  <section style="padding:18px 0;border-top:1px solid #eae4d9;">
    <h3 style="margin:0 0 8px;font-family:'Playfair Display',Georgia,serif;font-size:17px;font-weight:500;color:#1a1a2e;"><span style="font-family:Inter,sans-serif;font-size:10px;font-weight:700;color:#a68a4e;background:#faf7ee;padding:3px 8px;border-radius:4px;margin-right:14px;">§10</span>Underskrift<span style="margin-left:6px;font-style:italic;font-weight:400;color:#8b8578;font-size:14px;">/ Signature</span></h3>
    <p style="margin:0 0 5px;font-size:13px;color:#4b4a55;line-height:1.55;">Avtalet signeras elektroniskt med BankID via Stodonas signeringsflöde. Vid signering låses avtalsversionen, dokumenthash och audit trail skapas. Signerad PDF lagras i Stodonas avtalssystem.</p>
    <p style="color:#8b8578;font-style:italic;font-size:12.5px;line-height:1.5;padding-left:44px;margin-top:4px;">The contract is signed electronically with BankID via Stodona's signing flow. On signing, the contract version is locked, a document hash and audit trail are created. The signed PDF is stored in Stodona's contract system.</p>
  </section>

</div>

</div>

<div style="padding:40px 0 36px;margin-top:28px;background:#faf7ee;border-top:2px solid #1a1a2e;padding-left:32px;padding-right:32px;">
  <h3 style="font-family:'Playfair Display',Georgia,serif;font-size:23px;font-weight:500;color:#1a1a2e;margin:0 0 6px;">Signaturer<span style="margin-left:8px;font-style:italic;font-weight:400;color:#8b8578;font-size:17px;">/ Signatures</span></h3>
  <p style="font-size:12.5px;color:#4b4a55;margin:0;line-height:1.55;">Genom elektronisk signering nedan bekräftar parterna att de tagit del av och godkänner samtliga villkor.</p>
  <p style="color:#8b8578;font-style:italic;font-size:12.5px;margin:0 0 26px;">By signing electronically below, both parties confirm they have read and accept all terms.</p>
  <table style="width:100%;"><tr>
    <td style="width:50%;vertical-align:top;padding-right:16px;">
      <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:22px;">För Arbetsgivaren <span style="color:#8b8578;font-weight:600;">/ For Employer</span></div>
      <div style="height:1px;background:#4b4a55;margin-top:44px;margin-bottom:8px;"></div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:#1a1a2e;margin-bottom:3px;">{{company.signatory_name}}</div>
      <div style="font-size:11.5px;color:#8b8578;line-height:1.5;">Firmatecknare, {{company.name}}</div>
    </td>
    <td style="width:50%;vertical-align:top;padding-left:16px;">
      <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:22px;">Arbetstagare <span style="color:#8b8578;font-weight:600;">/ Employee</span></div>
      <div style="height:1px;background:#4b4a55;margin-top:44px;margin-bottom:8px;"></div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:#1a1a2e;margin-bottom:3px;">{{employee.first_name}} {{employee.last_name}}</div>
      <div style="font-size:11.5px;color:#8b8578;line-height:1.5;">{{employment.job_title}}<br/>Personnr {{employee.personal_number}}</div>
    </td>
  </tr></table>
</div>

<div style="padding:18px 0;background:#1a1a2e;color:#cec7b8;font-size:10.5px;letter-spacing:0.08em;text-align:center;">
  <strong style="color:#f5f3ef;">{{company.name}}</strong> · {{company.address}} · Stodona Standard v9 · SV / EN · {{today}}
</div>

</div>$V9$,
    "version" = 9,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "name" = 'Stodona Standard — Anställningsavtal';
