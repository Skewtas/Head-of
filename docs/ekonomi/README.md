# Ekonomi — gemensam uppföljning för Stodona AB och Stodona Services AB

Intern ledningsrapport. **Inte** en formell koncernredovisning, och systemet
utgår inte från att bolagen juridiskt är en koncern.

Fliken **EKONOMI** i Head of. Kod: `api/_lib/ekonomi/`, `api/routes/ekonomi.ts`,
`src/EkonomiView.tsx`. Tester: `bun test api/_lib/ekonomi`.

## Läget just nu (2026-10-02)

| Del | Status |
|---|---|
| Beräkningskärna (perioder, mappning, eliminering, balans, kontroller) | Byggd och testad med **testdata** |
| Fortnox-koppling (läsning, en per bolag) | Byggd enligt Fortnox dokumentation — **inte körd mot verkliga konton** |
| Databastabeller (`fin_*`) | Migrering skriven, **inte körd** (körs vid nästa deploy) |
| Verkliga siffror | **Finns inte ännu.** Inget i systemet är verifierat mot bolagens redovisning |

Systemet säger själv "Ej verifierad" tills kontrollerna nedan stöder något annat.

## Vad som är bekräftat, preliminärt och obesvarat

**Bekräftat**
- Organisationsnummer: Stodona AB 559201-1059, Stodona Services AB 559481-1332
  (enligt migrering `20260901_correct_company_orgnr`, "enligt Fortnox-registret").
- Alla externa kunder och kundavtal finns i Stodona AB. Cirka 70 % av personalen
  är anställd i Services. (70/30 används **inte** i någon beräkning.)
- Bolagen har olika räkenskapsår.

**Preliminärt (standardantaganden som måste bekräftas)**
- Kontomappningen följer BAS-kontoplanens kontoklasser. Varje konto visas som
  "standardregel" tills du bekräftat eller ändrat det.

**Svar från Mikaela 2026-10-02**
- Löner, semesterlöneskuld, pensioner och avgifter bokförs månadsvis. *(Bekräftat.)*
- Johan bokför. En månad är normalt färdig månaden efter, men underlag kommer
  ibland in sent. Månader ska därför ses som preliminära tills de märks avstämda. *(Bekräftat.)*
- Mikaela är ensam ägare, 100 %. *(Preliminärt: oklart om hon äger båda bolagen
  direkt eller om ett bolag äger det andra.)*
- Bolagen har Fortnox Lön. Kostnadsställen används inte. *(Bekräftat.)*
- Stodona Services AB fakturerar Stodona AB 2–3 gånger per månad. Services är
  leverantör nr 1 hos Stodona AB (och AB:s motpart för personalen). *(Bekräftat
  2026-10-02. Kundnumret som Stodona AB har i Services kundregister är inte
  känt ännu — läses ut ur Fortnox efter anslutning.)*

**Obesvarat**
1. Exakta räkenskapsår per bolag. (Läses automatiskt från Fortnox vid första hämtningen.)
2. Stodona AB:s kundnummer hos Services, och om internfakturan har påslag.
3. Konton för interna affärer, lån, räntor och avräkningar. (Mikaela vet inte —
   kan läsas ut ur verifikationerna för internfakturorna när bolagen är anslutna,
   och stämmas av med Johan.)
4. Moms på internfakturering; förekomst av ej avdragsgill moms.
5. Om kund-, projekt- och tidsdata kan kopplas till redovisningen.
6. Hur långt tillbaka historiken finns.

Punkt 2–3 är avgörande: **utan regler för interna affärer elimineras ingenting**
och totalen dubbelräknar internfaktureringen. Kontrollen "Interna poster" står
då som "Ej utförd" och blockerar verifiering.

## Datakällor

Verifierat mot Fortnox officiella API-dokumentation (api.fortnox.se/apidocs och
fortnox.se/developer) 2026-10-02.

| Uppgift | Fortnox-ändpunkt | Scope | Licens |
|---|---|---|---|
| Verifikationer, kontoplan, IB/UB | `GET /3/sie/4` per räkenskapsår | bookkeeping | Bokföring |
| Periodsaldon per månad | `GET /3/sie/2` | bookkeeping | Bokföring |
| Räkenskapsår | `GET /3/financialyears` | bookkeeping | Bokföring |
| Verifikationslista (antal, fakturakoppling) | `GET /3/vouchers` | bookkeeping | Bokföring |
| Kontosaldon (oberoende kontroll) | `GET /3/accounts` | bookkeeping | Bokföring |
| Org.nr (bolagsidentitet) | `GET /3/companyinformation` | companyinformation | — |
| Låst period | `GET /3/settings/lockedperiod` | settings | — |
| Obetalda kundfakturor | `GET /3/invoices` | invoice | Kundfaktura |
| Obetalda leverantörsfakturor | `GET /3/supplierinvoices` | supplierinvoice | Bokföring |

**Bokföringen är källan för resultat och balans.** Fakturor används bara för
att (a) visa förfallna fordringar och väntande betalningar och (b) känna igen
vilka verifikationer som gäller systerbolaget. Fakturabelopp summeras aldrig
in i resultatet, så samma händelse räknas inte två gånger.

**Löne- och tidsdata hämtas inte.** Scope `salary` kräver licensen Fortnox Lön
och `timereporting` kräver Tidredovisning; det är inte kartlagt om bolagen har
dem. Personalkostnaden kommer därför från bokföringen (konto 7000–7699), vilket
är rätt källa för bokförd kostnad. Inga uppgifter om enskilda anställda lagras.

**Personuppgifter.** Lagras: kund-/leverantörsnamn och nummer på obetalda
fakturor (behövs för att följa upp fordringar) samt verifikationstexter.
Lagras inte: adresser, personnummer, e-post, telefon, löneuppgifter per person.
Åtkomst kräver inloggning och att användaren finns i `EKONOMI_ALLOWED_USER_IDS`.

### Skrivskydd
Fortnox har **inga rena läsbehörigheter** — varje scope ger läs- och skrivrätt.
Skrivskyddet ligger därför i koden: `api/_lib/ekonomi/fortnox.ts` kan bara göra
`GET`-anrop. Vill du ha skyddet även hos Fortnox: anslut med en användare som
har läsbehörighet i Fortnox behörighetsinställningar.

### Säkerhet och robusthet
- En anslutning per bolag. Vid anslutning **och vid varje hämtning** kontrolleras
  att Fortnox-bolagets org.nr är det förväntade — annars avbryts allt.
- Token lagras krypterad (AES-256-GCM, nyckel i `EKONOMI_TOKEN_KEY`).
- Refresh tokens är engångs hos Fortnox; förnyelsen sker under radlås.
- Anropsgräns: 25 anrop/5 s per bolag. Koden håller ≈ 4,5 anrop/s och backar vid 429/5xx.
- Paginering: 500 per sida; antalet hämtade poster kontrolleras mot Fortnox uppgift.
- Idempotens: nyckeln (bolag, räkenskapsår, serie, nummer). Samma import två gånger
  ger samma data och inga ändringsposter.
- Rättelser/efterregistreringar: varje hämtning jämför hela räkenskapsåret mot
  det som fanns. Nya, ändrade och borttagna verifikationer loggas (`fin_changes`).
- Misslyckas en hämtning ligger tidigare data kvar orörd och felet visas.

## Beräkningsregler

**Belopp** lagras i hela ören. Kontroller görs på öret (tolerans 0 öre).
Avrundning till kronor sker bara i visningen.

**Tecken.** Bokföringen: debet +, kredit −. I resultatrapporten visas
resultatpåverkan: intäkter +, kostnader −. I balansrapporten visas tillgångar
som de är och eget kapital/skulder med omvänt tecken.

**Saknat underlag** visas som "saknas", aldrig som 0. Saknas det för ett bolag
blir även totalen "saknas".

### Perioder
Alla jämförelser avser exakt samma kalenderperiod i båda bolagen.
- **Resultat** = summan av verifikationsrader med verifikationsdatum i perioden,
  oavsett vilket räkenskapsår de ligger i. Årsrapporter summeras aldrig.
- **Balans** = ingående balans (från Fortnox) för räkenskapsåret som innehåller
  datumet + rörelser från årets början t.o.m. datumet.
- **Bokslutsomföring** (konto 8990–8999, årets resultat till eget kapital) hålls
  utanför resultatet. Annars skulle en period som passerar ett bokslut nollas.
- Rullande 12 = tolv hela kalendermånader. Föregående år = samma datum −1 år.
- "Bolagets eget räkenskapsår" visar perioden för valt bolag; det andra bolaget
  visas för samma kalenderperiod.

### Kontomappning (standardregel, BAS)
| Konto | Kategori |
|---|---|
| 3000–3799 | Nettoomsättning |
| 3800–3999 | Övriga rörelseintäkter |
| 4000–4999 | Material och köpta tjänster |
| 5000–6999 | Övriga externa kostnader |
| 7000–7699 | Personalkostnader |
| 7700–7899 | Av- och nedskrivningar |
| 7900–7999 | Övriga rörelsekostnader |
| 8000–8399 | Finansiella intäkter |
| 8400–8499 | Finansiella kostnader |
| 8800–8899 | Bokslutsdispositioner (per bolag) |
| 8900–8989 | Skatt (per bolag) |
| 8990–8999 | Omföring av årets resultat (ingår inte) |
| 1000–2999 | Balansräkning per kontoklass (se Inställningar) |

Konton utan regel (t.ex. 8500–8799 eller icke-numeriska) hamnar på raden
**Omappade konton**, syns alltid och blockerar verifiering. Konton som dykt upp
efter att du senast granskade mappningen flaggas som **nytt konto**.

### Nyckeltal
- **Sålt till externa kunder** = nettoomsättning i kolumnen Verksamheten totalt
  (efter eliminering av intern fakturering), exkl. moms.
- **Personalkostnad totalt** = konto 7000–7699 i båda bolagen. Inhyrd personal
  från utomstående (normalt 68xx) ingår inte.
- **Rörelseresultat** = konto 3000–7999.
- **Rörelsemarginal** = rörelseresultat ÷ nettoomsättning. Bolagens egna
  marginaler påverkas av internfaktureringen och säger lite var för sig.
- **Skatt** beräknas aldrig på det gemensamma resultatet. Bokförd skatt visas per bolag.

### Moms
Resultatet bygger på resultatkonton, som är exklusive avdragsgill moms.
Ej avdragsgill moms som bokförts som kostnad ingår automatiskt i kostnaden.

## Elimineringsregler

1. En rad är intern **endast** om en dokumenterad regel pekar ut den:
   - *Konto*: alla rörelser på ett visst konto i ett visst bolag.
   - *Motpart*: verifikationer för fakturor till/från systerbolagets kund- eller
     leverantörsnummer (gäller fakturaverifikationens resultatrader).
   - *Verifikation*: en enskild utpekad verifikation.
2. **Båda sidor elimineras var för sig**, med sitt bokförda belopp i sin bokförda
   månad. Totalen består därmed bara av externa poster:
   - Ett internt påslag blir aldrig vinst för helheten.
   - Externa lönekostnader elimineras aldrig — bara den interna fakturan.
3. **Matchningen är en kontroll**, inte en förutsättning. Ordning: samma
   fakturanummer → exakt motsatt belopp samma månad → exakt motsatt belopp inom
   3 månader. Inget tvingas ihop. Flaggor: *beloppsskillnad*, *olika månad*,
   *saknar motpost*.
4. **Elimineringsdifferens** = summan av elimineringskolumnen. Ska vara 0 kr.
5. **Balans**: interna fordringar/skulder elimineras via kontoregler (t.ex. ett
   avräkningskonto per bolag). Fordran + skuld per grupp ska bli 0 på rapportdatumet.
6. **Kassaflöde**: summan av bolagens förändring i likvida medel. Interna
   överföringar tar ut varandra om båda bokfört dem i samma period.

## Periodisering och rapportjusteringar

Bokförda siffror ändras aldrig. En **rapportjustering** är en separat post som
visas i egen kolumn och kräver: bolag, månad, kategori, belopp, källa, metod,
motivering, hantering samt **vändningsmånad** — månaden då den verkliga
bokningen kommer in. Justeringen vänds då automatiskt så att inget dubbelräknas.
En justering utan vändningsmånad blockerar verifiering. Justeringar gäller hela
månader. Systemet skapar inga egna uppskattningar.

## Periodstatus

| Status | Betydelse |
|---|---|
| Preliminär | Bokföringen kan vara ofullständig. Standardläge. |
| Avstämd | Du har intygat att månaden är färdig. Systemet sparar ett fingeravtryck av månadens bokföring och larmar om den ändras. |
| Stängd | Avstämd och dessutom låst i Fortnox. |

## Kontroller

Blockerande (måste vara gröna för "Verifierad"):
- Varje verifikation balanserar och ligger i rätt räkenskapsår.
- IB + rörelser = Fortnox utgående saldo per konto; rörelser = Fortnox resultat per konto (samma uttag).
- Antal verifikationer = Fortnox verifikationslista.
- Fullständig import för hela perioden i båda bolagen.
- Inga omappade konton med rörelse.
- Interna poster matchar; interna fordringar = skulder.
- Balansräkningen går ihop.
- Inga ändringar i avstämda perioder.
- Alla månader avstämda/stängda i båda bolagen.
- En första verklig avstämning är dokumenterad.

Informativa: månadssaldon mot SIE typ 2, saldon mot kontolistan, teckenkontroll,
skillnad i aktualitet mellan bolagen (> 24 h).

## Drift

Miljövariabler (Vercel):
```
FORTNOX_EKONOMI_CLIENT_ID / FORTNOX_EKONOMI_CLIENT_SECRET   Fortnox-appens nycklar
EKONOMI_TOKEN_KEY          openssl rand -base64 32
EKONOMI_ALLOWED_USER_IDS   Clerk-användar-id, kommaseparerade
CRON_SECRET                skyddar den schemalagda hämtningen
APP_URL                    t.ex. https://head-of.vercel.app
```
I Fortnox utvecklarportal: aktivera scopes `bookkeeping companyinformation
invoice supplierinvoice settings` och lägg till redirect-URI
`{APP_URL}/api/ekonomi/fortnox/callback`.

Schemalagd hämtning varje natt (vercel.json): innevarande år 03:30/03:35,
föregående år 03:40/03:45.

Kom igång:
1. Deploya (migreringen `20261002_ekonomi` skapar tabellerna `fin_*`).
2. EKONOMI → Inställningar → Anslut Fortnox för vartdera bolaget.
3. "Hämta all historik" per bolag.
4. Besvara kartläggningen och lägg in regler för interna affärer.
5. Hämta igen (reskontran för systerbolaget hämtas utifrån reglerna).
6. Välj en avslutad månad. Jämför bolagskolumnerna mot Fortnox resultat- och
   balansrapport för samma period, och kontrollera de interna mellanhavandena.
7. Märk månaden som avstämd i båda bolagen och dokumentera första avstämningen.

## Kända begränsningar

- **Inte körd mot verkliga Fortnox-konton.** Tolkningen av Fortnox SIE-export
  (särskilt ändrade verifikationer, `#BTRANS/#RTRANS`) bygger på SIE-standarden.
  Avviker Fortnox fångas det av saldokontrollen, men det måste prövas.
- Avstämningen mot `#UB/#RES` jämför mot Fortnox egna saldon ur samma fil. Den
  ersätter inte en jämförelse mot Fortnox resultat-/balansrapport (steg 6).
- Motpartsregler eliminerar resultatrader. Interna kundfordringar/leverantörsskulder
  på vanliga reskontrakonton (1510/2440) elimineras inte i balansen — använd
  särskilda konton, annars visas de bara som upplysning från reskontran.
- Reskontran visar läget vid senaste hämtning, inte historiska datum.
- RUT/ROT: kundfordran kan innehålla Skatteverkets del.
- Kommande löner och skatter syns först när de är bokförda. Ingen likviditetsprognos.
- Kund- och projektlönsamhet visas inte (underlag ej kartlagt).
- Endast SEK. Fakturor i annan valuta hanteras inte särskilt.
- Ändringar i föregående räkenskapsår upptäcks vid den nattliga hämtningen av
  föregående år; äldre år bara vid manuell hämtning.
- Vercel-funktioner har 60 s tidsgräns. Ett mycket stort räkenskapsår kan behöva
  längre tid; då misslyckas hämtningen synligt (ingen halv import).
- Varje rapport läser periodens verifikationer till minnet. Fungerar för
  normala volymer; kan behöva förädlas om det blir långsamt.
- Den äldre Fortnox-kopplingen (`api/_lib/fortnoxAuth.ts`, fliken försäljning) är
  orörd. Den har klienthemligheten hårdkodad i källkoden och är inte bolagsseparerad.
