# Raptr

Passrapportering för hotellvärdar. React-PWA + Supabase. Appen ligger i
`rapportapp/`, databasen och Edge Functions i `supabase/`.

Detaljerna finns i `rapportapp/README.md` — den är skriven för att läsas.
Här står bara sånt som är lätt att gå bet på.

## Cloudflare

Nya projekt hamnar i Workers-flödet, som deployar med `wrangler deploy`.
**Pages-flödet finns kvar men bara bakom en direktlänk:**

```
https://dash.cloudflare.com/<account-id>/workers-and-pages/create/pages
```

Byt ut `<account-id>` mot kontots id (står i dashboardens URL).

Välj **ett** av flödena — de krockar:

- **Workers** kräver `wrangler.toml` med `[assets]`. Den ligger redan i
  `rapportapp/`. Detta är vad projektet använder.
- **Pages** läser också `wrangler.toml` om den finns, och kräver då fältet
  `pages_build_output_dir`. Utan det avbryts Pages-bygget med ett
  konfigurationsfel — nuvarande fil är alltså skriven för Workers och stjälper
  Pages.

Root directory i byggkonfigurationen måste vara `rapportapp`. Missas den
hittar bygget ingen `package.json`.

SPA-fallbacken sköts av `not_found_handling` i `wrangler.toml`. Lägg **inte**
till ett `public/_redirects` med `/* /index.html 200` — Workers Assets tar bort
`.html` och `/index` automatiskt, så regeln pekar tillbaka på sig själv och
deployen avvisas med *"Infinite loop detected in this rule"*.

`VITE_*`-variabler måste sättas som **build**-variabler. Vite bakar in dem när
bundlen byggs; som runtime-variabler ser appen dem aldrig och startar i
demoläge mot seed-data.

## Tre ställen för hemligheter

Lätt att lägga rätt sak på fel ställe.

| Var | Vad | Varför |
| --- | --- | --- |
| Cloudflare → Build variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Bakas in i frontend-bundlen vid bygget. Publika — RLS är skyddet, inte nyckeln. |
| GitHub → Repository secrets | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | Används bara av `functions.yml` för att deploya. |
| Supabase → Edge Function Secrets |  `RESEND_API_KEY`, `RAPPORT_AVSANDARE` | Läses av servern vid varje anrop. Ingen ny deploy behövs när de ändras. |

`RESEND_API_KEY` i Cloudflare hamnar i JS-bundlen och blir publik — då kan vem
som helst skicka mejl i företagets namn. `SUPABASE_SERVICE_ROLE_KEY` ska
ingenstans sättas för hand: den injiceras automatiskt i Edge Functions, och
CLI:n vägrar ta emot variabler som börjar på `SUPABASE_`.

## Kommandon

Allt körs från `rapportapp/`:

```bash
npm run dev      # demoläge om .env.local saknas
npm test         # 189 tester
npm run lint
npm run build
```

## Regler som är lätta att bryta

- **Tester körs från `rapportapp/`**, inte från repo-roten. Tidszonen låses till
  `Europe/Stockholm` i `vite.config.js`, och nattpasstesterna är meningslösa i UTC.
- **Datumberoende tester ska låsa klockan** med `vi.setSystemTime`. Demopasset
  dateras dagens datum, så ett test som utgår från "nästa fredag" mäter något
  annat när det körs på en fredag.
- **Inlägg raderas eller redigeras aldrig.** Fel rättas med en rättelse som pekar
  på originalet; originalet står kvar överstruket i rapporten.
- **Passet dateras sin startdag.** Ett nattpass 22:00–06:00 hör till startdagens
  rapport, även inläggen efter midnatt.
- **RLS är skyddet, inte klienten.** Ändringar i behörighet ska verifieras mot en
  riktig Postgres, inte bara i gränssnittet.
- **Migrationer läggs till, ändras aldrig.** En redan körd fil som ändras stoppar
  Supabases GitHub-integration.
- **Edge Functions deployas av `.github/workflows/functions.yml`** vid push som rör
  `supabase/functions/`. Supabases egen GitHub-integration kör bara migrationer.
  Flödet kräver secrets `SUPABASE_ACCESS_TOKEN` och `SUPABASE_PROJECT_REF`.

## Domän och e-post

Mejlmallarna för inbjudan och lösenordsåterställning ligger i
`supabase/emails/` och klistras in i Authentication → Emails. De bor annars
bara i Supabases databas och följer varken med en migration eller en backup.

`raptr.se`. E-post går via Resend; DKIM och SPF ligger på `send.raptr.se`.
DMARC står på `p=reject`, så mejl studsar helt om DKIM inte är verifierat.
