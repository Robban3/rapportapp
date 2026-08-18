# Rapportapp

Passrapportering för hotellvärdar. Värdar skriver fria, tidsstämplade inlägg i ett
delat pass; inläggen sorteras automatiskt i tidsordning oavsett vem som skrev dem.
En administratör granskar den sammanställda rapporten och skickar den som PDF till kund.

Byggd som **React-PWA** (installerbar, offline-vänlig) med **Supabase** som backend.
Kör direkt mot inbyggd seed-data tills du kopplar ett eget Supabase-projekt.

## Snabbstart

Kräver **Node 20.19+ eller 22.12+** (`node --version`). Verktygskedjan bygger på
Vite 8, som inte startar på äldre Node.

```bash
npm install
npm run dev
```

Öppna adressen som visas. Appen startar i **demoläge** (seed-data i minnet).

Demoläget har ingen autentisering — e-posten pekar ut vem du är och lösenordet ignoreras.

| E-post              | Roll         | Sign. | Bemannad på dagens pass |
|---------------------|--------------|-------|-------------------------|
| zaem@example.se     | Värd         | ZÄEM  | ja                      |
| mobo@example.se     | Ordningsvakt | MOBO  | ja                      |
| varo@example.se     | Värd         | VARO  | nej                     |
| pesa@example.se     | Ordningsvakt | PESA  | nej                     |
| admin@example.se    | Admin        | ADM   | —                       |

Logga in som **admin@example.se** för adminpanelen (granska rapport, Bemanning,
Personal & behörighet). Logga in som **varo@example.se** för att se hur en obemannad
person möts.

## Koppla Supabase (skarp data)

Repot är ett Supabase CLI-projekt. Migrationerna i `supabase/migrations/` körs i
ordning — antingen av GitHub-integrationen vid push, eller lokalt med
`supabase db push`.

1. Skapa ett projekt på [supabase.com](https://supabase.com).
2. Koppla projektet till repot (Project Settings → Integrations → GitHub), eller kör
   `supabase link` och `supabase db push`.
3. Kopiera `.env.example` till `.env.local` och fyll i `VITE_SUPABASE_URL` och
   `VITE_SUPABASE_ANON_KEY` (Project Settings → API).
4. Deploya Edge Function för inbjudningar:
   ```bash
   supabase functions deploy bjud-in
   ```
   Ingen nyckel behöver sättas. `SUPABASE_URL`, `SUPABASE_ANON_KEY` och
   `SUPABASE_SERVICE_ROLE_KEY` injiceras automatiskt i funktionsmiljön, och
   `supabase secrets set` vägrar namn som börjar med `SUPABASE_`.
5. Lägg upp personalen under **Admin → Personal & behörighet** och tryck **Bjud in**.
   Kopplingen mellan personalrad och auth-konto sker automatiskt via en trigger,
   oavsett i vilken ordning de två skapas.
6. Starta om `npm run dev`.

Datalagret (`src/lib/api.js`) väljer backend själv: finns creds används Supabase,
annars mock. UI:t är identiskt i båda lägena.

### Inloggning

Personalen loggar in med **e-post och lösenord** via Supabase Auth. Lösenordet ligger
i `auth.users` och når aldrig klienten.

> **Stäng av självregistrering i dashboarden.** `supabase/config.toml` styr bara lokal
> utveckling — den påverkar inte det driftsatta projektet om du inte kör
> `supabase config push`. Gå till **Authentication → Sign In / Providers → Email** och
> slå av *Allow new users to sign up*. Utan det kan vem som helst skapa ett konto.
> Kontot hamnar visserligen utan personalrad och blir utsparkat vid inloggning, men
> det ska inte gå att skapa från början.

Tidigare loggade appen in genom att slå upp en PIN i `personal`-tabellen. Eftersom
anon-nyckeln ligger i JS-bundlen innebar det att vem som helst kunde läsa ut allas
koder. `kod`-kolumnen finns inte längre.

### Inbjudan sker i appen, inte i Supabase-dashboarden

`supabase/functions/bjud-in` låter en admin bjuda in personal direkt från panelen.
Att skapa konton kräver `service_role`-nyckeln, som går förbi all RLS och därför
aldrig får ligga i webbläsaren — funktionen kör serversidan och kontrollerar först
att anroparen verkligen är admin.

Alternativet vore att bjuda in via dashboarden på supabase.com. Det kräver att varje
app-administratör har ett Supabase-konto med projektåtkomst, alltså full läs- och
skrivrätt till hela databasen förbi RLS. Poängen med behörighetsmodellen är att
"admin i appen" och "ägare av databasen" ska kunna vara olika personer.

service_role-nyckeln finns aldrig i repot och behöver inte sättas: plattformen
injicerar den i funktionsmiljön. Försöker man ändå sätta den svarar CLI:n
*"Env name cannot start with SUPABASE_, skipping"* — och hoppar över den tyst.

> **Obs:** inbjudningsmejl kräver egen SMTP i Supabase (Project Settings → Auth →
> SMTP Settings). Det inbyggda utskicket har hård kvot och är avsett för test.
> Utan SMTP svarar funktionen med felet från Supabase i klartext i panelen.

`supabase/functions/` deployas **inte** av GitHub-integrationen — den kör bara
migrations. Kör `supabase functions deploy bjud-in` när funktionen ändras.

## Struktur

```
src/
  lib/
    api.js         # datalager — samma API mot Supabase och mock
    supabase.js    # klient (null om creds saknas)
    mockStore.js   # seed-data i minnet för demoläge
    time.js        # tidsparsning + sortnyckel (nattpass hanteras)
    incidents.js   # incidenttyper som driver statistiken
    utkorg.js      # kö för inlägg som skrivs utan nät
    tema.js        # ljust/mörkt läge
  state/session.jsx# inloggad personal
  pages/
    Login.jsx      # inloggning via Supabase Auth (e-post + lösenord)
    Objects.jsx    # objektlista — kopplade objekt, med bemanningsstatus
    ShiftLog.jsx   # passlogg, fria inlägg, delad i realtid (polling)
    admin/
      Admin.jsx      # adminlayout + routing
      ReviewList.jsx # pass att granska / skickade
      ReportDetail.jsx # sammanställd rapport + skicka
      Objekt.jsx     # hotellen: namn, kod, standardtider, mottagare, instruktioner
      Bemanning.jsx  # lägg upp pass + bemanna det (styr åtkomst)
      Staff.jsx      # personal & behörighet (koppla objekt)
supabase/
  config.toml        # CLI-projekt; GitHub-integrationen läser härifrån
  migrations/        # körs i ordning mot databasen
  seed.sql           # demodata för lokal utveckling
```

## Mörkt läge

Passloggen används i mörk hotellobby kl 02:00. En vit skärm är där ett
arbetsmiljöproblem, inte en smaksak — därför finns mörkt läge, och det gäller
hela appen.

Systemets inställning styr som utgångspunkt. Knappen i topbaren (och i
adminpanelens sidfot) tvingar fram ett läge oavsett vad surfplattan är
inställd på, och valet sparas i `localStorage`. Temat skrivs på `<html>` av
`applicera()` i `main.jsx` **innan** React monterar, annars hinner en vit skärm
blinka förbi.

Mörka läget är rena tokenbyten i `[data-tema="morkt"]` — komponenterna är redan
tokenstyrda. Två saker skiljer sig från att bara invertera:

- **Ytorna ljusnar uppåt.** Den ljusaste ytan i bilden ska vara ett litet kort,
  aldrig hela sidan.
- **Text på accenten blir mörk.** Vitt på `#2dd4bf` ger under 2:1. Uppmätt i
  webbläsaren: brödtext 15,8:1, skicka-knappen 9,1:1 — båda över WCAG AA.

`color-scheme: dark` sätts också, annars ritar webbläsaren datumväljaren och
kryssrutorna som vita fläckar i en mörk vy.

## Behörighet — två nivåer

| Nivå | Tabell | Sätts i | Styr |
|------|--------|---------|------|
| Objekt | `personal_objekt` | Personal & behörighet | Vilka objekt personen ser och **får** bemannas på |
| Pass | `pass_personal` | Bemanning | Vem som **faktiskt** kommer åt passloggen för ett objekt ett datum |

Objektkopplingen ensam ger alltså ingen åtkomst till någon logg. Admin lägger upp passet
under **Bemanning** (objekt + datum + tider) och bockar in vilka som jobbar det; först då
kan de skriva och läsa. Passet skapas aldrig av personalen — `aktivtPassForStaff()` hämtar
bara, `openPassForObjekt()` skapar och anropas enbart från adminpanelen.

Objektlistan visar tre lägen per objekt, så kortet aldrig ljuger: **Öppna** (bemannad på ett
pass som pågår), **Ej bemannad** (pass pågår, men du står inte på det) och **Inget pass nu**
(kvällens pass har inte börjat än). En låst rapport går inte att skriva vidare i.

Starttiden är inte kosmetisk: `sortKey()` räknar inläggens ordning från den, så ändras den
i efterhand räknar `setPassTider()` om `sortnyckel` för passets alla inlägg.

## Objekt

Hotellen läggs upp under **Admin → Objekt**. Utöver namn och objektkod bär objektet
tre saker som appen använder aktivt:

| Fält | Vad det gör |
|------|-------------|
| Standardtider | Förifylls när du lägger upp ett pass under Bemanning. Sluttiden är den appen behöver för att veta när loggen stänger |
| Rapportmottagare | En **lista** av adresser — rapporten går sällan till bara en. Normaliseras, dubbletter fälls ihop |
| Instruktioner | Visas för värdarna högst upp i passloggen, ovanför inläggen så de inte hamnar i rapporten |

Kontaktperson och telefon visas också i passloggen, med klickbart nummer.

**Objekt raderas aldrig, bara inaktiveras.** Främmande nycklarna kaskaderar: en radering
skulle ta med sig objektets alla pass, all bemanning och alla inlägg — även rapporter som
gått till kund. Ett inaktivt objekt försvinner ur alla listor men behåller sin historik.

## Pass över midnatt

**Ett pass är daterat sin startdag.** Det är hela regeln — allt annat följer av den.

Ett pass som börjar 22:00 den 16:e och slutar 06:00 den 17:e är **ett** pass, daterat
`2026-08-16`. Klockan 02:00 skriver värden fortfarande i 16:e:s pass, och hela natten
hamnar i samma rapport med samma datum.

Tre saker faller ut av det:

- **Passet öppnas och stängs av sina egna tider.** `passFonster()` räknar ut det verkliga
  fönstret: ligger sluttiden inte efter starttiden hör den till nästa dygn. `arPassAktivt()`
  svarar på om nuet ligger inom fönstret, med en timmes tolerans i varje ände så att den som
  kommer tidigt eller skriver sitt sista inlägg 03:05 inte låses ute.
- **Ingen gissad brytpunkt.** Tidigare avgjorde `verksamhetsdatum()` saken med en fast gräns
  kl 05:00. En värd som jobbade 22:00–06:00 tappade då sitt pass klockan fem, en timme innan
  hen slutade. `verksamhetsdatum()` används numera bara som förvalt datum i adminpanelen —
  praktiskt, för kl 02:00 är det gårdagens pass man vill bemanna.
- **Inläggens ordning räknas från passets start, inte från midnatt.** Skriv klockslaget som
  det står på klockan; 02:15 hamnar efter 23:00, inte först i rapporten.

| Klockan | Vad appen gör med ett pass 22:00–06:00 daterat 16 aug |
|---|---|
| 16 aug 21:30 | Öppet — en halvtimme tidigt ryms i toleransen |
| 16 aug 23:50 | Öppet |
| 17 aug 00:10 | Öppet, fortfarande 16 aug:s pass |
| 17 aug 05:30 | Öppet — här tappade den gamla brytpunkten passet |
| 17 aug 07:30 | Stängt, rapporten går till granskning |

Sätt alltid sluttiden i Bemanning. Utan den vet appen inte när loggen ska stängas och
räknar passet som öppet ett dygn från starten.

### Spärren ligger i databasen

RLS är aktivt på alla tabeller (`supabase/migrations/*_auth_rls.sql`). Klienten är ett
bekvämt gränssnitt, inte skyddet. Verifierat mot Postgres att en inloggad värd **inte**
kan skriva i ett låst pass, skriva i någon annans namn, bemanna sig själv, lägga upp
egna pass, göra sig till admin, eller ändra och radera inlägg. Utloggade når ingenting.

## Rättelser

Ett inlägg går aldrig att redigera eller radera — inte heller av den som skrev det.
Blev något fel skrivs en **rättelse** i stället: en ny rad som pekar på originalet
med `inlagg.rattar_id`.

- Originalet står kvar i loggen och i rapporten, **överstruket** och märkt *Rättad*.
- Rättelsen visas direkt under originalet, märkt *Rättelse*, oavsett när den skrevs.
- Statistiken räknar rättelsens incidenttagg, inte originalets. En felaktig tagg
  följer alltså inte med till kunden.

Databasen håller reglerna, inte bara gränssnittet
(`supabase/migrations/*_rattelser.sql`, verifierat mot Postgres):

- ett inlägg kan rättas **en** gång (unikt index på `rattar_id`)
- en rättelse kan inte rättas
- rättelsen måste ligga i **samma pass** som originalet
- rättelser går bara att skriva i ett **öppet** pass — efter att rapporten är låst
  får ingen skriva, inte heller en rättelse

Klicka **Rätta** på inlägget i passloggen. Tid, text och tagg förifylls så bara det
felaktiga behöver skrivas om.

## Utan nät

Hotellpass går i garage, källarplan och hisschakt. Skrivs ett inlägg där hamnar det
i en **utkorg** i telefonen i stället för att gå förlorat:

- inlägget visas i loggen märkt *Väntar på nät*, streckat
- kön ligger i `localStorage` och överlever att appen stängs
- när nätet kommer tillbaka skickas kön i den ordning inläggen skrevs
- id:t sätts på telefonen, så ett omskick efter ett tappat svar blir **en** rad i
  rapporten, inte två
- ett inlägg som *nekas* (låst pass, saknad behörighet) köas inte om i evighet —
  det märks *Kom inte fram* med orsaken, och värden kan försöka igen eller slänga det

Kön är knuten både till enheten och till personen: loggar någon annan in på samma
telefon går inte den förras inlägg iväg i hens namn.

## Datamodell (kort)

- **objekt** — hotellen. **personal** — värdar/OV/garderob, kopplade till ett auth-konto via e-post.
- **personal_objekt** — kopplingen som styr vad appen visar per person.
- **pass** — ett arbetspass på ett objekt en dag. **pass_personal** — vilka som jobbade (roster).
- **inlagg** — fria anteckningar (tid + text + signatur, valfri incident-tagg).
  `rattar_id` pekar på det inlägg raden rättar (se Rättelser).

Statistiken i rapporten räknas automatiskt från inlägg som taggats med en incidenttyp,
så ingen manuell ifyllnad krävs vid pass-slut.

## Att bygga vidare på (TODO)

- **PDF + e-post:** `lockAndSend()` i `api.js` markerar passet som skickat. Koppla en
  [Supabase Edge Function](https://supabase.com/docs/guides/functions) som genererar
  PDF (t.ex. med en HTML-mall) och skickar via Resend/Postmark/SES.
- **Realtid:** `ShiftLog.jsx` pollar var 15:e sekund (pausar när fliken är dold eller
  enheten är offline). Byt till Supabase Realtime (`supabase.channel(...)`) för
  direktuppdatering när flera skriver samtidigt.
