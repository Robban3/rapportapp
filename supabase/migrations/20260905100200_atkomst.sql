-- Två räcken som hittills bara fanns i klienten.

-- ---------- 1. Personalregistret ----------
-- Policyn `for select to authenticated using (true)` plus en tabellbred grant
-- gjorde att vilken inloggad värd som helst kunde hämta
-- /rest/v1/personal?select=* med anon-nyckeln ur JS-bundlen och sin egen token,
-- och få ut samtliga anställdas e-post, roll och auth_user_id — även för objekt
-- hen inte är kopplad till. Det är färdig rekognosering för riktad phishing mot
-- administratören, och det neutraliserade dessutom att lösenordsåterställningen
-- medvetet inte avslöjar vilka adresser som finns.
--
-- Radpolicyn ligger kvar: appen behöver kollegornas signaturer för att kunna
-- visa vem som skrev vad i passloggen. Det som stramas åt är KOLUMNERNA.
-- RLS-predikat får läsa auth_user_id även utan kolumnrättighet.
revoke select on personal from authenticated;
grant select (id, namn, initialer, roll, aktiv) on personal to authenticated;

/* Adminpanelen behöver e-post och kontostatus. Kolumnrättigheter kan inte
   skilja på admin och värd — båda är rollen `authenticated` — så den vägen går
   genom en funktion som kontrollerar rollen i stället. */
create or replace function public.personal_for_admin()
returns setof personal language plpgsql stable security definer set search_path = public as $$
begin
  if not ar_admin() then
    raise exception 'Bara administratörer får läsa personalregistret.'
      using errcode = 'insufficient_privilege';
  end if;
  return query select * from personal order by initialer;
end $$;

/* Inbjudningsfunktionen slår upp mottagaren på e-post och behöver veta om det
   redan finns ett konto. Samma kontroll, ett svar. */
create or replace function public.personal_for_invite(p_epost text)
returns table (id uuid, auth_user_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ar_admin() then
    raise exception 'Bara administratörer får bjuda in personal.'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select p.id, p.auth_user_id from personal p where lower(p.epost) = lower(btrim(p_epost));
end $$;

grant execute on function public.personal_for_admin, public.personal_for_invite to authenticated;

-- ---------- 2. Objekt raderas aldrig ----------
-- Regeln fanns beskriven i klienten och implementerad som setObjectAktiv, men
-- databasen kaskaderade: objekt -> pass -> pass_personal och inlagg. En
-- admin-token räckte för DELETE /rest/v1/objekt?id=eq.… och all historik var
-- borta, inklusive rapporter som redan gått till kund. Jämför inlagg.personal_id
-- som saknar on delete och därmed skyddar personalen — objektet får samma skydd.
alter table pass drop constraint if exists pass_objekt_id_fkey;
alter table pass add constraint pass_objekt_id_fkey
  foreign key (objekt_id) references objekt(id) on delete restrict;

revoke delete on objekt from authenticated;

-- ---------- 3. Index som saknades ----------
-- staffForObjekt frågar på objekt_id, men primärnyckeln är (personal_id,
-- objekt_id) och det enda extra indexet leder med personal_id. Frågan blev en
-- seq scan, och samma sak gällde kaskadkontrollen från objekt.
create index if not exists personal_objekt_objekt on personal_objekt (objekt_id);
