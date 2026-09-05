-- Skilj "låst" från "skickat".
--
-- Tidigare fanns bara `skickat`, och funktionen som mejlar rapporten satte det
-- för att låsa passet — innan mejlet gick iväg. Gick utskicket fel låg passet
-- kvar i "Skickade" med tidsstämpel, visuellt identiskt med en rapport som
-- faktiskt nått kunden. Ett bortfall upptäcktes först när hotellet hörde av
-- sig, om ens då.
--
-- Nu finns ett mellanläge: `last` betyder att loggen är stängd men rapporten
-- inte bekräftat levererad. Passet blir `skickat` först när Resend svarat 2xx.

alter table pass add column if not exists utskick_id  text;   -- Resends message-id
alter table pass add column if not exists utskick_fel text;   -- senaste felorsak

comment on column pass.utskick_id is
  'Message-id från Resend. Enda handtaget för att spåra en leverans i efterhand.';
comment on column pass.utskick_fel is
  'Varför senaste utskicket misslyckades. Nollställs när rapporten går fram.';

-- Statuskolumnen har ingen check-constraint, så värdet behöver bara
-- dokumenteras. Ordningen är oppet -> granskas -> last -> skickat.
comment on column pass.status is
  'oppet | granskas | last | skickat. `last` = loggen stängd, rapporten ej bekräftat levererad.';

-- Ett låst pass får inte växa. Tidigare räckte det att inte vara `skickat`,
-- vilket hade släppt in nya inlägg i det nya mellanläget — mitt emellan att
-- rapporten renderats och att den skickats.
create or replace function public.pass_oppet(p_pass_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pass where id = p_pass_id and status not in ('last', 'skickat')
  )
$$;

-- Rapportlistan hämtar på status och sorterar på datum. Utan index blir det en
-- seq scan över varje pass som någonsin lagts upp.
create index if not exists pass_status_datum on pass (status, datum desc);
