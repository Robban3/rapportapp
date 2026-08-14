# Rapportapp

Passrapportering för hotellvärdar. Värdar skriver fria, tidsstämplade inlägg i ett
delat pass; inläggen sorteras automatiskt i tidsordning oavsett vem som skrev dem.
En administratör granskar den sammanställda rapporten och skickar den som PDF till kund.

Byggd som **React-PWA** (installerbar, offline-vänlig) med **Supabase** som backend.
Kör direkt mot inbyggd seed-data tills du kopplar ett eget Supabase-projekt.

## Snabbstart

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

Logga in som **0000** för att nå adminpanelen (granska rapport + Personal & behörighet).

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
    Objects.jsx    # objektlista — visar BARA kopplade objekt
    ShiftLog.jsx   # passlogg, fria inlägg, delad i realtid (polling)
    admin/
      Admin.jsx      # adminlayout + routing
      ReviewList.jsx # pass att granska / skickade
      ReportDetail.jsx # sammanställd rapport + skicka
      Staff.jsx      # personal & behörighet (koppla objekt)
supabase/schema.sql  # databasschema + seed
```

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
  (kommenterade som utgångspunkt) så objekt-behörigheten upprätthålls i databasen.
- **Realtid:** `ShiftLog.jsx` pollar var 5:e sekund. Byt till Supabase Realtime
  (`supabase.channel(...)`) för direktuppdatering när flera skriver samtidigt.
- **Offline-kö:** service workern cachar skalet; lägg till en utgående kö för inlägg
  som skrivs utan nät och synka när uppkoppling återkommer.
- **Spårbarhet:** inlägg har fältet `last` (låst). Lägg till rättelser som nya rader
  i stället för redigering om rapporterna ska hålla juridiskt.
