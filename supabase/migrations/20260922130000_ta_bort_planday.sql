-- Tar bort Planday-kopplingen.
--
-- Integrationen blir inte av. Allt som byggdes för den plockas bort:
-- kopplingsnycklarna, skrivvägen, synkloggen och listan över omatchad personal.
-- Edge-funktionen och dess tester tas bort i samma commit.
--
-- Migrationer läggs till, aldrig ändras: 20260910120000, 20260910130000 och
-- 20260922120000 har redan körts mot produktionen och rörs inte. De backas här
-- i stället.
--
-- TVÅ SAKER BEHÅLLS med flit. De låg i Planday-migrationerna men är rättelser
-- av veckoschemats generator och har ingenting med Planday att göra:
--
--   1. on conflict i stället för select-then-insert. En 23505 rullade tidigare
--      tillbaka HELA funktionen, så två samtidiga körningar gav noll pass.
--   2. Svenskt datum i stället för current_date. Databasen kör UTC medan
--      mocken i api.js räknar lokalt, så knappen gav fel dag efter midnatt.
--
-- Veckoschemat under /admin/schema är därmed åter enda vägen att lägga upp
-- pass i förväg, och generatorn går över samtliga aktiva objekt igen.

-- ---------- Generatorn utan Planday-undantaget ----------
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
       where s.aktiv and o.aktiv and s.veckodag = extract(isodow from d)
    loop
      -- Konfliktmålet pekas ut med constraint-namnet, inte med kolumnerna:
      -- objekt_id och datum är OUT-parametrar och plpgsql hade tolkat dem som
      -- variabler i en kolumnlista.
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

-- ---------- Bort med skrivvägen ----------
drop function if exists public.synka_planday(uuid, jsonb);
drop function if exists public.foreslagen_signatur(text);

-- ---------- Bort med tabellerna ----------
drop table if exists planday_synk;
drop table if exists planday_omatchad;

-- ---------- Bort med kopplingsnycklarna ----------
-- Kolumnerna är tomma: ingen väg fanns i appen för att sätta ett department-id,
-- så synken kördes aldrig skarpt. Indexen faller med kolumnerna.
alter table objekt        drop column if exists planday_department_id;
alter table personal      drop column if exists planday_employee_id;
alter table pass_personal drop column if exists planday_shift_id;
