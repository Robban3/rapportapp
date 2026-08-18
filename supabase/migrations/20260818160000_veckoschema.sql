-- Veckoschema per objekt.
--
-- Bemanningen har lagts upp för hand varje dag: samma objekt, samma tider,
-- ofta samma personer. Här beskrivs i stället hur en normalvecka ser ut på
-- objektet, och passen skapas i förväg utifrån det.
--
-- Schemat SKAPAR pass, det styr dem inte. Ett upplagt pass ändras aldrig i
-- efterhand av schemat: ändrar admin tider eller bemanning på en enskild dag
-- ska den ändringen stå kvar. Undantag och sjukfrånvaro hanteras alltså där
-- de hör hemma — på passet.

-- ---------- Schemarader ----------
-- En rad per objekt och veckodag. Veckodagen är ISO: 1 = måndag, 7 = söndag,
-- samma som `extract(isodow ...)`, så generatorn slipper översätta.
--
-- Passet dateras sin STARTDAG. Ett nattpass som börjar fredag 22:00 och slutar
-- lördag 06:00 är alltså fredagens rad, inte lördagens.
create table if not exists objekt_schema (
  id           uuid primary key default gen_random_uuid(),
  objekt_id    uuid not null references objekt(id) on delete cascade,
  veckodag     smallint not null check (veckodag between 1 and 7),
  starttid     time not null,
  sluttid      time,
  aktiv        boolean not null default true,
  skapad_at    timestamptz not null default now(),
  unique (objekt_id, veckodag)
);
create index if not exists objekt_schema_objekt on objekt_schema (objekt_id);

-- ---------- Standardbemanning per schemarad ----------
-- Vilka som normalt jobbar den dagen. Kopieras till pass_personal när passet
-- skapas — och styr därmed vem som kommer åt passloggen, precis som en
-- handpålagd bemanning.
create table if not exists schema_personal (
  schema_id    uuid not null references objekt_schema(id) on delete cascade,
  personal_id  uuid not null references personal(id) on delete cascade,
  roll         text,
  tid_in       text,
  tid_ut       text,
  primary key (schema_id, personal_id)
);
create index if not exists schema_personal_personal on schema_personal (personal_id);

-- ---------- Generatorn ----------
-- Skapar pass för de kommande dagarna ur schemat.
--
-- security definer: den skriver i pass och pass_personal, som bara admin får
-- röra. Kontrollen görs därför först — utan den vore funktionen en väg runt
-- RLS för vem som helst.
--
-- Idempotent: ett pass som redan finns för objekt+datum lämnas orört, och
-- bemanningen läggs bara till för den som inte redan står på passet.
create or replace function public.skapa_pass_fran_schema(p_dagar int default 14)
returns table (objekt_id uuid, datum date, skapat boolean)
language plpgsql security definer set search_path = public as $$
declare
  rad record;
  d date;
  nytt_pass uuid;
begin
  if not ar_admin() then
    raise exception 'Bara administratörer får skapa pass från schemat.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_dagar is null or p_dagar < 1 or p_dagar > 90 then
    raise exception 'Antal dagar måste vara mellan 1 och 90.' using errcode = 'check_violation';
  end if;

  for d in select generate_series(current_date, current_date + (p_dagar - 1), interval '1 day')::date
  loop
    for rad in
      select s.* from objekt_schema s
        join objekt o on o.id = s.objekt_id
       where s.aktiv and o.aktiv and s.veckodag = extract(isodow from d)
    loop
      select p.id into nytt_pass from pass p
       where p.objekt_id = rad.objekt_id and p.datum = d;

      if nytt_pass is not null then
        -- Dagen är redan upplagd. Rör den inte: tider och bemanning kan vara
        -- medvetet ändrade.
        objekt_id := rad.objekt_id; datum := d; skapat := false;
        return next;
        continue;
      end if;

      insert into pass (objekt_id, datum, starttid, sluttid)
        values (rad.objekt_id, d, rad.starttid, rad.sluttid)
        returning id into nytt_pass;

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

grant execute on function public.skapa_pass_fran_schema(int) to authenticated;

-- ---------- Rättigheter ----------
revoke all on objekt_schema, schema_personal from anon;
revoke all on objekt_schema, schema_personal from authenticated;
grant select, insert, update, delete on objekt_schema, schema_personal to authenticated;

alter table objekt_schema   enable row level security;
alter table schema_personal enable row level security;

-- Schemat är planering, inte åtkomstkontroll — den ligger kvar i pass_personal.
-- Personalen får se sitt eget schema; ändra får bara admin.
drop policy if exists "personal ser schemat för sina objekt" on objekt_schema;
create policy "personal ser schemat för sina objekt" on objekt_schema
  for select to authenticated using (
    ar_admin() or exists (
      select 1 from personal_objekt po
       where po.objekt_id = objekt_schema.objekt_id
         and po.personal_id = aktuell_personal_id()
    )
  );

drop policy if exists "bara admin ändrar schemat" on objekt_schema;
create policy "bara admin ändrar schemat" on objekt_schema
  for all to authenticated using (ar_admin()) with check (ar_admin());

drop policy if exists "personal ser sin schemabemanning" on schema_personal;
create policy "personal ser sin schemabemanning" on schema_personal
  for select to authenticated using (
    ar_admin() or personal_id = aktuell_personal_id()
  );

drop policy if exists "bara admin ändrar schemabemanningen" on schema_personal;
create policy "bara admin ändrar schemabemanningen" on schema_personal
  for all to authenticated using (ar_admin()) with check (ar_admin());
