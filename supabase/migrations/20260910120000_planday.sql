-- Koppling mot Planday.
--
-- Passen läggs redan ut i Planday, där personalen söker de pass de vill jobba.
-- Ett eget veckoschema i Raptr hade betytt att samma schema underhölls på två
-- ställen. Raptr läser därför i stället från Planday: kontoret gör ingenting
-- nytt, och Raptr följer efter.
--
-- Kopplingen är per objekt. Ett objekt utan planday_department_id styrs av
-- veckoschemat precis som förut, så utrullningen kan ske ett objekt i taget.
--
-- Ett Planday-shift är EN PERSON. Ett Raptr-pass är ETT DYGN PÅ ETT OBJEKT.
-- Femton personer på ett evenemang är alltså femton shifts i Planday och blir
-- ett pass med femton rader bemanning här. Grupperingen görs i Edge-funktionen
-- (verksamhetsdygnet avgör datumet, inte kalenderdagen); den här funktionen tar
-- emot färdiggrupperade pass och skriver dem.

-- ---------- Kopplingsnycklar ----------
-- objekt, pass och pass_personal har tabellbreda grants, så nya kolumner täcks
-- automatiskt. personal har SELECT på en kolumnlista (se 20260905100200) — men
-- personal_for_admin() returnerar `setof personal` och får den nya kolumnen
-- utan ändring.
alter table objekt        add column if not exists planday_department_id int;
alter table personal      add column if not exists planday_employee_id  int;
alter table pass_personal add column if not exists planday_shift_id     bigint;

comment on column pass_personal.planday_shift_id is
  'Shiftet i Planday som raden kommer från. NULL = tillagd för hand, och då rör synken den aldrig.';

create unique index if not exists objekt_planday_department
  on objekt (planday_department_id) where planday_department_id is not null;
create unique index if not exists personal_planday_employee
  on personal (planday_employee_id) where planday_employee_id is not null;
create index if not exists pass_personal_planday_shift
  on pass_personal (planday_shift_id) where planday_shift_id is not null;

-- ---------- Synkloggen ----------
-- Ger två saker: strypning (passloggen får be om en synk, men högst en gång per
-- objekt och minut) och "senast synkad" i adminpanelen. Utan det första blir
-- 60-sekunderspollningen i ShiftLog ett anrop mot Plandays API per öppen telefon.
create table if not exists planday_synk (
  objekt_id        uuid primary key references objekt(id) on delete cascade,
  synkad_at        timestamptz not null default now(),
  antal_pass       int not null default 0,
  antal_bemanning  int not null default 0,
  fel              text
);

-- ---------- Personal som inte gick att matcha ----------
-- Matchningen sker på planday_employee_id i första hand och e-post i andra. Den
-- som inte går att koppla hamnar här i stället för att tyst falla bort — annars
-- står en värd utan logg och ingen förstår varför.
create table if not exists planday_omatchad (
  planday_employee_id int primary key,
  namn                text,
  epost               text,
  sedd_at             timestamptz not null default now()
);

-- ---------- Skrivvägen ----------
-- security definer: den skriver i pass och pass_personal, som bara admin får
-- röra. Den anropas bara av Edge-funktionen med service role — därför revoke
-- nedan, inklusive från PUBLIC (Supabase delar ut execute på nya funktioner i
-- public till anon/authenticated via default privileges).
--
-- p_pass är en array:
--   [{ datum, starttid, sluttid,
--      bemanning: [{ planday_shift_id, planday_employee_id, epost, namn,
--                    roll, tid_in, tid_ut }] }]
create or replace function public.synka_planday(p_objekt_id uuid, p_pass jsonb)
returns table (pass_rorda int, bemanning_rorda int, omatchade int)
language plpgsql security definer set search_path = public as $$
declare
  rad         jsonb;
  b           jsonb;
  pid         uuid;
  person      uuid;
  status_nu   text;
  shift_ids   bigint[];
begin
  pass_rorda := 0; bemanning_rorda := 0; omatchade := 0;

  if p_objekt_id is null or p_pass is null then
    raise exception 'synka_planday kräver objekt och passlista.' using errcode = 'check_violation';
  end if;

  for rad in select * from jsonb_array_elements(p_pass)
  loop
    -- Ett låst eller skickat pass rörs aldrig. Rapporten är levererad; den får
    -- inte ändras i efterhand.
    select p.id, p.status into pid, status_nu
      from pass p
     where p.objekt_id = p_objekt_id and p.datum = (rad->>'datum')::date;

    if status_nu in ('last', 'skickat') then
      continue;
    end if;

    if pid is null then
      -- on conflict, inte select-then-insert: den nattliga körningen och en
      -- admin som trycker på knappen kan mötas, och då ska ingen av dem falla.
      insert into pass (objekt_id, datum, starttid, sluttid)
        values (p_objekt_id, (rad->>'datum')::date,
                (rad->>'starttid')::time, (rad->>'sluttid')::time)
        on conflict (objekt_id, datum) do nothing
        returning id into pid;

      if pid is null then
        select p.id into pid from pass p
         where p.objekt_id = p_objekt_id and p.datum = (rad->>'datum')::date;
      end if;
    else
      update pass p
         set starttid = (rad->>'starttid')::time,
             sluttid  = (rad->>'sluttid')::time
       where p.id = pid
         and (p.starttid is distinct from (rad->>'starttid')::time
           or p.sluttid  is distinct from (rad->>'sluttid')::time);
    end if;

    pass_rorda := pass_rorda + 1;
    shift_ids := '{}';

    for b in select * from jsonb_array_elements(coalesce(rad->'bemanning', '[]'::jsonb))
    loop
      shift_ids := shift_ids || (b->>'planday_shift_id')::bigint;

      -- Planday-id först, e-post som reserv. Matchar den på e-post lärs
      -- Planday-id:t in, så nästa synk slipper gissa.
      select p.id into person from personal p
       where p.planday_employee_id = (b->>'planday_employee_id')::int;

      if person is null and nullif(btrim(coalesce(b->>'epost', '')), '') is not null then
        select p.id into person from personal p
         where lower(p.epost) = lower(btrim(b->>'epost'));

        if person is not null then
          update personal p set planday_employee_id = (b->>'planday_employee_id')::int
           where p.id = person and p.planday_employee_id is null;
        end if;
      end if;

      if person is null then
        insert into planday_omatchad (planday_employee_id, namn, epost, sedd_at)
          values ((b->>'planday_employee_id')::int, b->>'namn', b->>'epost', now())
          on conflict (planday_employee_id)
            do update set namn = excluded.namn, epost = excluded.epost, sedd_at = now();
        omatchade := omatchade + 1;
        continue;
      end if;

      delete from planday_omatchad o
       where o.planday_employee_id = (b->>'planday_employee_id')::int;

      insert into pass_personal (pass_id, personal_id, roll, tid_in, tid_ut, planday_shift_id)
        values (pid, person, b->>'roll', b->>'tid_in', b->>'tid_ut',
                (b->>'planday_shift_id')::bigint)
        on conflict (pass_id, personal_id) do update
          set roll             = excluded.roll,
              tid_in           = excluded.tid_in,
              tid_ut           = excluded.tid_ut,
              planday_shift_id = excluded.planday_shift_id;

      bemanning_rorda := bemanning_rorda + 1;
    end loop;

    -- Den som lämnat ifrån sig passet i Planday tas bort — men bara rader som
    -- synken själv äger (planday_shift_id not null), och bara om personen inte
    -- skrivit något. pass_personal är åtkomstkontrollen: tas raden bort förlorar
    -- personen sin egen text.
    delete from pass_personal pp
     where pp.pass_id = pid
       and pp.planday_shift_id is not null
       and not (pp.planday_shift_id = any (shift_ids))
       and not exists (select 1 from inlagg i
                        where i.pass_id = pid and i.personal_id = pp.personal_id);
  end loop;

  insert into planday_synk (objekt_id, synkad_at, antal_pass, antal_bemanning, fel)
    values (p_objekt_id, now(), pass_rorda, bemanning_rorda, null)
    on conflict (objekt_id) do update
      set synkad_at = now(), antal_pass = excluded.antal_pass,
          antal_bemanning = excluded.antal_bemanning, fel = null;

  return next;
end $$;

revoke all on function public.synka_planday(uuid, jsonb) from public, anon, authenticated;

-- ---------- Veckoschemat lämnar Planday-objekten i fred ----------
-- Migrationer läggs till, ändras aldrig — 20260818160000 rörs inte. Funktionen
-- ersätts här i stället, med tre ändringar:
--
--   1. Objekt med planday_department_id hoppas över. De styrs av Planday.
--   2. select-then-insert byts mot on conflict. Med ett nattligt jobb blir
--      kapplöpningen mot admin-knappen verklig, och en 23505 rullade tidigare
--      tillbaka HELA funktionen — inga pass alls den natten.
--   3. current_date byts mot svenskt datum. Databasen kör UTC medan mocken i
--      api.js räknar lokalt; en admin som tryckte på knappen efter midnatt fick
--      fel dag.
create or replace function public.skapa_pass_fran_schema(p_dagar int default 14)
returns table (objekt_id uuid, datum date, skapat boolean)
language plpgsql security definer set search_path = public as $$
declare
  rad record;
  d date;
  d0 date := (now() at time zone 'Europe/Stockholm')::date;
  nytt_pass uuid;
begin
  if not ar_admin() then
    raise exception 'Bara administratörer får skapa pass från schemat.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_dagar is null or p_dagar < 1 or p_dagar > 90 then
    raise exception 'Antal dagar måste vara mellan 1 och 90.' using errcode = 'check_violation';
  end if;

  for d in select generate_series(d0, d0 + (p_dagar - 1), interval '1 day')::date
  loop
    for rad in
      select s.* from objekt_schema s
        join objekt o on o.id = s.objekt_id
       where s.aktiv and o.aktiv
         and o.planday_department_id is null
         and s.veckodag = extract(isodow from d)
    loop
      -- Konfliktmålet pekas ut med constraint-namnet, inte med kolumnerna:
      -- objekt_id och datum är OUT-parametrar i den här funktionen och plpgsql
      -- hade tolkat dem som variabler i en kolumnlista.
      insert into pass as p (objekt_id, datum, starttid, sluttid)
        values (rad.objekt_id, d, rad.starttid, rad.sluttid)
        on conflict on constraint pass_objekt_id_datum_key do nothing
        returning p.id into nytt_pass;

      if nytt_pass is null then
        -- Dagen är redan upplagd. Rör den inte: tider och bemanning kan vara
        -- medvetet ändrade.
        objekt_id := rad.objekt_id; datum := d; skapat := false;
        return next;
        continue;
      end if;

      insert into pass_personal (pass_id, personal_id, roll, tid_in, tid_ut)
        select nytt_pass, sp.personal_id, sp.roll, sp.tid_in, sp.tid_ut
          from schema_personal sp
         where sp.schema_id = rad.id
        on conflict do nothing;

      objekt_id := rad.objekt_id; datum := d; skapat := true;
      return next;
    end loop;
  end loop;
end $$;

-- ---------- Rättigheter ----------
-- Synkloggen läses av adminpanelen; omatchade likaså. Ingen av dem skrivs från
-- klienten — det gör bara synken, via service role.
revoke all on planday_synk, planday_omatchad from anon, authenticated;
grant select on planday_synk, planday_omatchad to authenticated;

alter table planday_synk     enable row level security;
alter table planday_omatchad enable row level security;

drop policy if exists "bara admin ser synkloggen" on planday_synk;
create policy "bara admin ser synkloggen" on planday_synk
  for select to authenticated using (ar_admin());

drop policy if exists "bara admin ser omatchade" on planday_omatchad;
create policy "bara admin ser omatchade" on planday_omatchad
  for select to authenticated using (ar_admin());
