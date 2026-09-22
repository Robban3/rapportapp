-- Synken skapar personalen och kopplar den till objektet.
--
-- Planday löste schemat men lämnade tre tabeller åt kontoret: personal,
-- personal_objekt och objekt.planday_department_id. Räknat i handgrepp var det
-- ~8 + N per person, där N är antalet objekt personen jobbar på. Med ett par
-- hundra anställda är det ett projekt i sig, inte "inget extraarbete".
--
-- Den här migrationen tar bort två av de tre:
--
--   personal_objekt  — är du schemalagd på ett objekt är du kopplad till det.
--   personal         — finns du i Planday med namn och e-post finns du i Raptr.
--
-- Det värsta tysta felet försvinner med den första. objectsForStaff läser ur
-- personal_objekt, så en värd som var bemannad men saknade kopplingsrad fick en
-- TOM objektlista utan förklaring — passet fanns, bemanningen fanns, RLS hade
-- tillåtit skrivning, men appen visade ingen väg dit.
--
-- Migrationer läggs till, aldrig ändras: 20260910120000 och 20260910130000 rörs
-- inte. synka_planday ersätts här.

-- ---------- Signatur ----------
-- Signaturen står i rapporten kunden läser, så den ska vara läsbar och unik.
-- Konventionen i registret är tilltalsnamnet i versaler (ZÄEM, PESA, MOBO),
-- inte initialer — regeln följer den.
--
-- Sätts BARA när personen skapas. En signatur som en admin ändrat efteråt
-- skrivs aldrig över av nästa synk.
create or replace function public.foreslagen_signatur(p_namn text)
returns text language plpgsql stable set search_path = public as $$
declare
  bas     text;
  forslag text;
  n       int := 1;
begin
  -- Förnamnet, bokstäver enbart. [:alpha:] täcker åäö i UTF-8.
  bas := upper(regexp_replace(split_part(btrim(coalesce(p_namn, '')), ' ', 1),
                              '[^[:alpha:]]', '', 'g'));
  if bas = '' then return null; end if;

  bas := left(bas, 6);
  forslag := bas;

  -- Vid krock läggs en siffra till: PESA, PESA2, PESA3. Taket finns för att en
  -- oväntad datamängd aldrig ska kunna snurra funktionen för evigt.
  while exists (select 1 from personal p where p.initialer = forslag) and n < 99 loop
    n := n + 1;
    forslag := left(bas, 6 - length(n::text)) || n::text;
  end loop;

  return forslag;
end $$;

revoke all on function public.foreslagen_signatur(text) from public, anon, authenticated;

-- ---------- Synken ----------
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
  emp_id      int;
  epost_ren   text;
  namn_ren    text;
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
      emp_id    := (b->>'planday_employee_id')::int;
      epost_ren := nullif(btrim(coalesce(b->>'epost', '')), '');
      namn_ren  := nullif(btrim(coalesce(b->>'namn', '')), '');

      -- Planday-id först, e-post som reserv. Matchar den på e-post lärs
      -- Planday-id:t in, så nästa synk slipper leta.
      select p.id into person from personal p where p.planday_employee_id = emp_id;

      if person is null and epost_ren is not null then
        select p.id into person from personal p where lower(p.epost) = lower(epost_ren);

        if person is not null then
          update personal p set planday_employee_id = emp_id
           where p.id = person and p.planday_employee_id is null;
        end if;
      end if;

      -- Finns personen i Planday med namn och e-post finns hen i Raptr. Det är
      -- det som gör att kontoret slipper lägga upp folk för hand.
      --
      -- Skyddet mot att skriva över en signatur som en admin rättat ligger INTE
      -- i `on conflict do nothing` nedan — den raden nås bara i en kapplöpning,
      -- eftersom matchningen ovan redan hittat personen. Skyddet är att namn,
      -- initialer och roll aldrig UPPDATERAS någonstans i funktionen. Frestelsen
      -- att "hålla raden i synk med Planday" är just det som skulle bryta det.
      if person is null and epost_ren is not null and namn_ren is not null then
        insert into personal (namn, initialer, roll, epost, planday_employee_id)
          values (namn_ren, foreslagen_signatur(namn_ren), 'Värd', epost_ren, emp_id)
          on conflict do nothing
          returning id into person;

        -- Kapplöpning mot en annan körning: raden finns redan, läs om den.
        if person is null then
          select p.id into person from personal p
           where lower(p.epost) = lower(epost_ren) or p.planday_employee_id = emp_id;
        end if;
      end if;

      if person is null then
        -- Kvar står bara det som inte går att skapa: anställd utan e-post eller
        -- utan namn i Planday. Den listan visas i adminpanelen.
        insert into planday_omatchad (planday_employee_id, namn, epost, sedd_at)
          values (emp_id, namn_ren, epost_ren, now())
          on conflict (planday_employee_id)
            do update set namn = excluded.namn, epost = excluded.epost, sedd_at = now();
        omatchade := omatchade + 1;
        continue;
      end if;

      delete from planday_omatchad o where o.planday_employee_id = emp_id;

      -- Är du schemalagd på objektet är du kopplad till det. Utan raden läser
      -- objectsForStaff en tom lista och värden ser ingen väg in.
      --
      -- Kopplingen tas ALDRIG bort av synken: har man jobbat där en gång ska
      -- man fortsatt se objektet och sina gamla loggar.
      insert into personal_objekt (personal_id, objekt_id)
        values (person, p_objekt_id) on conflict do nothing;

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
    -- eller bytt person. Jämförelsen går på PARET (shift_id, personal_id):
    -- ett överlåtet pass behåller sitt shift-id men byter anställd.
    --
    -- Två skydd står kvar:
    --   planday_shift_id is not null  — en handpålagd rad rörs aldrig.
    --   not exists (... inlagg ...)   — den som skrivit behåller sin text och
    --                                   därmed sin åtkomst.
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
