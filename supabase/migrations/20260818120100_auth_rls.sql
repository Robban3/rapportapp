-- =====================================================================
-- Supabase Auth + Row Level Security.
--
-- Före den här migrationen låg åtkomstkontrollen enbart i webbläsaren:
-- anon-nyckeln ligger i JS-bundlen och gav därmed vem som helst läs- och
-- skrivrätt till alla tabeller, inklusive personalens PIN-koder. Nu görs
-- spärren i databasen och klienten är bara ett bekvämt gränssnitt.
-- =====================================================================

-- ---------- Personal kopplas till auth.users ----------
alter table personal add column if not exists epost text;
alter table personal add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists personal_epost_unik on personal (lower(epost)) where epost is not null;
create unique index if not exists personal_auth_user_unik on personal (auth_user_id) where auth_user_id is not null;

-- PIN-koden är inte längre autentisering, och en läsbar lösenordskolumn är
-- exakt det vi vill bli av med. Lösenordet bor i auth.users.
alter table personal drop column if exists kod;

-- Admin lägger upp personen med e-post och bjuder in hen via Supabase Auth.
-- Den här triggern knyter ihop de två när kontot skapas.
create or replace function public.koppla_personal_till_auth()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update personal
     set auth_user_id = new.id
   where auth_user_id is null
     and epost is not null
     and lower(epost) = lower(new.email);
  return new;
end $$;

drop trigger if exists pa_ny_auth_user on auth.users;
create trigger pa_ny_auth_user
  after insert on auth.users
  for each row execute function public.koppla_personal_till_auth();

-- Och åt andra hållet: läggs personen upp EFTER att kontot skapats hittar
-- triggern ovan ingenting att koppla, och personen blir permanent utelåst.
-- Kopplingen måste fungera oavsett i vilken ordning de två sker.
create or replace function public.koppla_auth_till_personal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auth_user_id is null and new.epost is not null then
    select id into new.auth_user_id from auth.users where lower(email) = lower(new.epost);
  end if;
  return new;
end $$;

drop trigger if exists pa_ny_personal on personal;
create trigger pa_ny_personal
  before insert or update of epost on personal
  for each row execute function public.koppla_auth_till_personal();

-- ---------- Hjälpfunktioner ----------
-- security definer är avsiktligt: funktionerna läser `personal` och
-- `pass_personal`, och utan det skulle policyer som anropar dem hamna i
-- oändlig rekursion mot sina egna tabeller.

create or replace function public.aktuell_personal_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from personal where auth_user_id = auth.uid() and aktiv limit 1
$$;

create or replace function public.ar_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from personal
     where auth_user_id = auth.uid() and aktiv and roll = 'Admin'
  )
$$;

/* Är den inloggade bemannad på passet? Detta ÄR åtkomstkontrollen. */
create or replace function public.ar_bemannad(p_pass_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from pass_personal pp
      join personal pe on pe.id = pp.personal_id
     where pp.pass_id = p_pass_id and pe.auth_user_id = auth.uid() and pe.aktiv
  )
$$;

/* Ett låst pass får inte växa. Spärren fanns i klienten och i datalagret —
   här är den på riktigt. */
create or replace function public.pass_oppet(p_pass_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from pass where id = p_pass_id and status <> 'skickat')
$$;

grant execute on function public.aktuell_personal_id, public.ar_admin,
                         public.ar_bemannad, public.pass_oppet to authenticated;

-- ---------- RLS på ----------
alter table objekt          enable row level security;
alter table personal        enable row level security;
alter table personal_objekt enable row level security;
alter table pass            enable row level security;
alter table pass_personal   enable row level security;
alter table inlagg          enable row level security;

-- Utloggade ska inte nå någonting. RLS utan policy för anon räcker, men
-- Supabase delar ut default privileges till anon på nya tabeller, så en
-- explicit revoke behövs för att avsikten ska hålla.
revoke all on objekt, personal, personal_objekt, pass, pass_personal, inlagg from anon;

-- Rättigheterna för inloggade sätts explicit i stället för att ärvas från
-- projektets default privileges. RLS avgör VILKA rader som syns; grants
-- avgör om tabellen är nåbar alls, och de två ska inte kunna glida isär.
revoke all on objekt, personal, personal_objekt, pass, pass_personal from authenticated;
grant select, insert, update, delete on objekt, personal, personal_objekt,
      pass, pass_personal to authenticated;

-- Inlägg får skapas och läsas, aldrig ändras eller raderas.
--
-- En grant ADDERAR rättigheter, den ersätter inte. Supabase har redan delat ut
-- full rätt på tabellen via default privileges, så utan revoken nedan skulle
-- update och delete vara tillåtna på grant-nivå och spårbarheten hänga på
-- enbart avsaknaden av policy. Nu stoppas de i båda lagren.
revoke all on inlagg from authenticated;
grant select, insert on inlagg to authenticated;

-- ---------- personal ----------
-- Läsbar för inloggade: rapporten och passloggen visar kollegornas signaturer
-- och namn, och PostgREST hämtar dem genom en join hit.
-- OBS: det innebär att inloggad personal ser varandras namn och e-post. Inga
-- hemligheter finns kvar i tabellen sedan `kod` togs bort. Vill ni strama åt
-- ytterligare får e-posten flyttas till en egen admin-tabell.
create policy "inloggade ser personalen" on personal
  for select to authenticated using (true);

create policy "bara admin ändrar personalen" on personal
  for all to authenticated using (ar_admin()) with check (ar_admin());

-- ---------- objekt ----------
create policy "personal ser sina objekt" on objekt
  for select to authenticated using (
    ar_admin() or exists (
      select 1 from personal_objekt po
       where po.objekt_id = objekt.id and po.personal_id = aktuell_personal_id()
    )
  );

create policy "bara admin ändrar objekt" on objekt
  for all to authenticated using (ar_admin()) with check (ar_admin());

-- ---------- personal_objekt ----------
create policy "personal ser sina kopplingar" on personal_objekt
  for select to authenticated using (ar_admin() or personal_id = aktuell_personal_id());

create policy "bara admin kopplar" on personal_objekt
  for all to authenticated using (ar_admin()) with check (ar_admin());

-- ---------- pass ----------
create policy "bemannad personal ser passet" on pass
  for select to authenticated using (ar_admin() or ar_bemannad(id));

-- Passet läggs upp i adminpanelen. Utan detta kunde vem som helst med
-- objektbehörighet skapa ett pass hen inte är bemannad på och skriva i det.
create policy "bara admin lägger upp pass" on pass
  for all to authenticated using (ar_admin()) with check (ar_admin());

-- ---------- pass_personal (bemanningen) ----------
create policy "se bemanningen på sina pass" on pass_personal
  for select to authenticated using (
    ar_admin() or personal_id = aktuell_personal_id() or ar_bemannad(pass_id)
  );

-- Ingen ska kunna bemanna sig själv — det vore att skriva sitt eget passerkort.
create policy "bara admin bemannar" on pass_personal
  for all to authenticated using (ar_admin()) with check (ar_admin());

-- ---------- inlagg ----------
create policy "bemannad personal läser passloggen" on inlagg
  for select to authenticated using (ar_admin() or ar_bemannad(pass_id));

create policy "bemannad personal skriver i passloggen" on inlagg
  for insert to authenticated with check (
    personal_id = aktuell_personal_id()   -- ingen skriver i någon annans namn
    and ar_bemannad(pass_id)
    and pass_oppet(pass_id)
  );

-- Medvetet inga update- eller delete-policyer: ett inlägg är en tidsstämplad
-- anteckning i en rapport som kan gå till kund. Rättelser läggs till som nya
-- rader, inte genom att skriva om historien.
