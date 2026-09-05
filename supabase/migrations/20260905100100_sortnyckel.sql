-- Sorteringsnyckeln räknas i databasen i stället för i webbläsaren.
--
-- Två fel löses på en gång.
--
-- 1. Admin kunde inte rätta tiden på ett pass som redan hade inlägg.
--    setPassTider uppdaterade inlagg.sortnyckel per rad, men `authenticated`
--    har bara select och insert på tabellen. Passets tid ändrades, omsorteringen
--    nekades med 42501, och inläggen låg kvar sorterade mot den gamla starttiden
--    — vilket gav fel ordning i rapporten till kund.
--
-- 2. Klienten skickade in sortnyckeln själv. Med tabellbred insert-grant kunde
--    en bemannad värd sätta sortnyckel 0 och lägga sitt inlägg först i kundens
--    rapport, oavsett klockslag.
--
-- Regeln är densamma som sortKey() i rapportapp/src/lib/time.js. Ändras den ena
-- måste den andra följa med; testerna jämför dem mot varandra.

-- Minuter från midnatt för tidens START. "20:45-21:30" ger 20:45.
-- Otolkbar text ger null, aldrig 0 — noll hade lagt inlägget först.
create or replace function public.klockslag_minuter(p_tid text)
returns int language plpgsql immutable as $$
declare
  forsta text;
  tim int;
  min int;
  traff text[];
begin
  if p_tid is null then return null; end if;

  -- Intervall delas på bindestreck, tankstreck eller långt tankstreck.
  forsta := btrim(split_part(regexp_replace(p_tid, '[–—]', '-', 'g'), '-', 1));
  if forsta = '' then return null; end if;

  -- "14:30", "14.30", "14:30:00"
  traff := regexp_match(forsta, '^(\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?$');
  if traff is null then
    -- "930" -> 09:30, "2045" -> 20:45
    traff := regexp_match(forsta, '^(\d{1,2})(\d{2})$');
  end if;
  if traff is null then
    -- "9" -> 09:00
    traff := regexp_match(forsta, '^(\d{1,2})$');
    if traff is null then return null; end if;
    tim := traff[1]::int;
    min := 0;
  else
    tim := traff[1]::int;
    min := traff[2]::int;
  end if;

  if tim > 23 or min > 59 then return null; end if;
  return tim * 60 + min;
end $$;

/* Minuter räknat från passets start, så att inlägg efter midnatt hamnar sist
   på ett nattpass utan att tidiga morgoninlägg på ett dagpass gör det.

   Tidstoleransen på 60 minuter före start är samma som TIDIG_TOLERANS i
   time.js: ett inlägg strax före passet räknas som tidigt i passet, inte som
   nästa dygn. Otolkbar tid sorteras sist. */
create or replace function public.berakna_sortnyckel(p_tid text, p_starttid time)
returns int language plpgsql immutable as $$
declare
  minuter int := klockslag_minuter(p_tid);
  start int;
begin
  if minuter is null then return 2147483647; end if;
  if p_starttid is null then return minuter; end if;

  start := extract(hour from p_starttid)::int * 60 + extract(minute from p_starttid)::int;
  return ((minuter - start + 60) % 1440 + 1440) % 1440 - 60;
end $$;

-- Sortnyckeln sätts här, inte av klienten. Ett medskickat värde ignoreras.
create or replace function public.satt_sortnyckel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sortnyckel := berakna_sortnyckel(new.tid, (select starttid from pass where id = new.pass_id));
  return new;
end $$;

drop trigger if exists inlagg_sortnyckel on inlagg;
create trigger inlagg_sortnyckel before insert on inlagg
  for each row execute function satt_sortnyckel();

/* Räknar om hela passet efter att starttiden ändrats. En sats, inte ett
   HTTP-anrop per inlägg — ett pass med 80 inlägg gav 80 sekventiella anrop
   från webbläsaren, och avbröts något halvvägs låg inläggen sorterade mot två
   olika ankare utan att något såg trasigt ut.

   security definer: ingen roll har UPDATE på inlagg, och ska inte ha det.
   Spårbarheten bygger på att inlägg inte går att skriva om — det här är det
   enda undantaget, och det rör bara sorteringen. */
create or replace function public.sortera_om_pass(p_pass_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  start time;
  antal int;
begin
  if not ar_admin() then
    raise exception 'Bara administratörer får sortera om ett pass.'
      using errcode = 'insufficient_privilege';
  end if;

  select starttid into start from pass where id = p_pass_id;
  if not found then
    raise exception 'Passet finns inte.' using errcode = 'no_data_found';
  end if;

  update inlagg set sortnyckel = berakna_sortnyckel(tid, start) where pass_id = p_pass_id;
  get diagnostics antal = row_count;
  return antal;
end $$;

grant execute on function public.klockslag_minuter, public.berakna_sortnyckel,
                         public.sortera_om_pass to authenticated;

-- Kolumnlista i stället för tabellbredd. Utan den kunde en värd sätta sin egen
-- skapad_at och backdatera ett inlägg sju timmar — och hela "historien skrivs
-- aldrig om"-designen vilar på att den tidsstämpeln är sann.
revoke insert on inlagg from authenticated;
grant insert (id, pass_id, personal_id, tid, meddelande, incident_typ, rattar_id)
  on inlagg to authenticated;
