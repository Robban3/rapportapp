# E-postmallar för Supabase Auth

Klistras in i Supabase → Authentication → **Emails** → Templates. En flik per
mall; ämnesraden sätts i fältet ovanför HTML-rutan.

De ligger i repot för att inte gå förlorade — mallarna bor i Supabases databas
och följer varken med en migration eller en backup av koden.

| Fil | Supabase-mall | Ämnesrad |
| --- | --- | --- |
| `inbjudan.html` | Invite user | `Du har fått ett konto i Raptr` |
| `aterstall.html` | Reset Password | `Återställ ditt lösenord i Raptr` |
| `bekrafta.html` | Confirm signup | `Bekräfta din e-postadress` |
| `byt-epost.html` | Change Email Address | `Bekräfta din nya e-postadress` |

`Confirm signup` ska normalt aldrig skickas: självregistrering är avstängd, och
konton skapas genom inbjudan. Mallen finns som skyddsnät ifall någon slår på
det, så att ingen får ett engelskt standardmejl.

## Variabler

- `{{ .ConfirmationURL }}` — länken som utför åtgärden
- `{{ .Email }}` — mottagarens adress
- `{{ .NewEmail }}` — bara i Change Email Address
- `{{ .SiteURL }}` — appens adress

## Varför de ser gammaldags ut

Tabeller och inline-stilar, inga webbfonter. E-postklienter stryper allt annat:
Outlook renderar med Word, och Gmail slänger `<style>`-block i vidarebefordrade
mejl. Samma skäl som rapportmallen i `functions/skicka-rapport/`.
