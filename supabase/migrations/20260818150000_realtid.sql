-- Realtid i passloggen.
--
-- Klienten pollade var 15:e sekund. Med flera värdar på samma pass innebar
-- det både onödiga anrop och att kollegans inlägg dröjde upp till en kvart.
-- Publikationen nedan gör att Supabase Realtime skickar ändringarna direkt.
--
-- RLS gäller fortfarande: Realtime kör prenumerationen med den inloggades
-- rättigheter, så den som inte får läsa passloggen får heller inga
-- händelser från den.

do $$
begin
  -- I ett Supabase-projekt finns publikationen redan. Migrationen ska ändå gå
  -- att köra mot en tom databas (t.ex. i test).
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inlagg'
  ) then
    alter publication supabase_realtime add table public.inlagg;
  end if;

  -- Passet behövs också: låser admin rapporten mitt i passet ska skrivfältet
  -- stängas direkt, inte vid nästa poll.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pass'
  ) then
    alter publication supabase_realtime add table public.pass;
  end if;
end $$;
