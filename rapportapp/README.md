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

Testkoder:

| Kod  | Roll         | Signatur |
|------|--------------|----------|
| 1111 | Värd         | ZÄEM     |
| 2222 | Värd         | VARO     |
| 3333 | Ordningsvakt | PESA     |
| 4444 | Ordningsvakt | MOBO     |
| 0000 | Admin        | ADM      |

Logga in som **0000** för att nå adminpanelen (granska rapport, Bemanning, Personal & behörighet).

I demoläget är **ZÄEM** och **MOBO** bemannade på dagens pass på Clarion Draken, medan
**VARO** och **PESA** är kopplade till objektet men inte bemannade — logga in som 2222
för att se hur en obemannad person möts.

## Koppla Supabase (skarp data)

1. Skapa ett projekt på [supabase.com](https://supabase.com).
2. Kör `supabase/schema.sql` i Supabase SQL Editor (skapar tabeller, vyer och seed).
3. Kopiera `.env.example` till `.env.local` och fyll i `VITE_SUPABASE_URL` och
   `VITE_SUPABASE_ANON_KEY` (Project Settings → API).
4. Starta om `npm run dev`. Appen använder nu Supabase automatiskt.

Datalagret (`src/lib/api.js`) väljer backend själv: finns creds används Supabase,
annars mock. UI:t är identiskt i båda lägena.

## Struktur

```
src/
  lib/
    api.js         # datalager — samma API mot Supabase och mock
    supabase.js    # klient (null om creds saknas)
    mockStore.js   # seed-data i minnet för demoläge
    time.js        # tidsparsning + sortnyckel (nattpass hanteras)
    incidents.js   # incidenttyper som driver statistiken
  state/session.jsx# inloggad personal
  pages/
    Login.jsx      # inloggning med personlig kod
    Objects.jsx    # objektlista — kopplade objekt, med bemanningsstatus
    ShiftLog.jsx   # passlogg, fria inlägg, delad i realtid (polling)
    admin/
      Admin.jsx      # adminlayout + routing
      ReviewList.jsx # pass att granska / skickade
      ReportDetail.jsx # sammanställd rapport + skicka
      Bemanning.jsx  # lägg upp pass + bemanna det (styr åtkomst)
      Staff.jsx      # personal & behörighet (koppla objekt)
supabase/schema.sql  # databasschema + seed
```

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

> **Obs:** spärren ligger i klienten så länge inloggningen sker med personlig kod i
> datalagret. För skarp drift måste den upprätthållas med RLS — se de färdiga
> policy-exemplen i `supabase/schema.sql`.

## Datamodell (kort)

- **objekt** — hotellen. **personal** — värdar/OV/garderob med personlig kod.
- **personal_objekt** — kopplingen som styr vad appen visar per person.
- **pass** — ett arbetspass på ett objekt en dag. **pass_personal** — vilka som jobbade (roster).
- **inlagg** — fria anteckningar (tid + text + signatur, valfri incident-tagg).

Statistiken i rapporten räknas automatiskt från inlägg som taggats med en incidenttyp,
så ingen manuell ifyllnad krävs vid pass-slut.

## Att bygga vidare på (TODO)

- **PDF + e-post:** `lockAndSend()` i `api.js` markerar passet som skickat. Koppla en
  [Supabase Edge Function](https://supabase.com/docs/guides/functions) som genererar
  PDF (t.ex. med en HTML-mall) och skickar via Resend/Postmark/SES.
- **Riktig autentisering:** demon loggar in via personlig kod i datalagret. För skarp
  drift, byt till Supabase Auth och aktivera RLS-policyerna i `schema.sql`
  (kommenterade som utgångspunkt) så objekt- och bemanningsspärren upprätthålls i
  databasen i stället för bara i klienten.
- **Realtid:** `ShiftLog.jsx` pollar var 5:e sekund. Byt till Supabase Realtime
  (`supabase.channel(...)`) för direktuppdatering när flera skriver samtidigt.
- **Offline-kö:** service workern cachar skalet; lägg till en utgående kö för inlägg
  som skrivs utan nät och synka när uppkoppling återkommer.
- **Spårbarhet:** inlägg har fältet `last` (låst). Lägg till rättelser som nya rader
  i stället för redigering om rapporterna ska hålla juridiskt.
