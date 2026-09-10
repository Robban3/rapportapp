-- Rättar borttagningen när ett pass överlåts.
--
-- I Planday går pass att sälja och överlåta — statusarna ForSale och
-- PendingSwapAcceptance finns just för det. Ett överlåtet pass BEHÅLLER SITT
-- SHIFT-ID men byter employeeId, och det fallet höll inte den första versionen:
--
--   and not (pp.planday_shift_id = any (shift_ids))
--
-- Säljer A sitt pass till B kommer shift 901 tillbaka i nyttolasten med B som
-- anställd. B lades till, men A:s rad stod kvar eftersom 901 fortfarande fanns
-- i shift_ids. A behöll alltså skrivrättighet till nattens logg trots att hen
-- sålt passet — och pass_personal ÄR åtkomstkontrollen.
--
-- Rätt jämförelse är PARET (shift_id, personal_id), inte bara shift-id:t.
--
-- Paret läggs till först när personen gått att matcha. Går den nye innehavaren
-- inte att matcha försvinner den gamle ändå — hen har inte passet längre — och
-- den omatchade hamnar i planday_omatchad där en admin ser den.
--
-- Migrationer läggs till, aldrig ändras: 20260910120000 är redan körd och rörs
-- inte. Funktionen ersätts här.
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
  person_ids  uuid[];
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
    shift_ids := '{}'; person_ids := '{}';

    for b in select * from jsonb_array_elements(coalesce(rad->'bemanning', '[]'::jsonb))
    loop
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

      -- Paret sparas först här, efter matchningen. Är innehavaren omatchad
      -- finns inget par, och den förre innehavaren tas då bort nedan.
      shift_ids  := shift_ids  || (b->>'planday_shift_id')::bigint;
      person_ids := person_ids || person;

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

    -- Den som lämnat ifrån sig passet tas bort — vare sig shiftet försvunnit
    -- eller bytt person. Två skydd står kvar:
    --   planday_shift_id is not null  — en handpålagd rad rörs aldrig.
    --   not exists (... inlagg ...)   — den som skrivit behåller sin text och
    --                                   därmed sin åtkomst. Hann någon jobba en
    --                                   del av passet innan det överläts ska
    --                                   raden finnas kvar.
    delete from pass_personal pp
     where pp.pass_id = pid
       and pp.planday_shift_id is not null
       and not exists (
             select 1 from unnest(shift_ids, person_ids) as t(sid, pers)
              where t.sid = pp.planday_shift_id and t.pers = pp.personal_id)
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
