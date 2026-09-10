-- Nattlig körning av Planday-synken.
--
-- Ligger i en egen migration, skild från logiken i 20260910120000 och
-- 20260910130000, så att all funktionskod körs fullt ut i CI medan bara
-- schemaläggningen hoppas över där.
--
-- FÖRUTSÄTTNING: pg_cron och pg_net aktiveras EN GÅNG för hand i
-- Dashboard → Database → Extensions. Grants på schemat `cron` läggs medvetet
-- inte här — `postgres` äger inte schemat, och ett misslyckat grant hade
-- stoppat hela migrationskön mot produktionen.
--
-- Jobbet anropar Edge-funktionen i stället för att skriva direkt: synken
-- behöver nå ett externt API, vilket databasen inte gör själv. pg_net skickar
-- anropet asynkront och blockerar därför inte cron-slotten.

do $mig$
declare
  projekt_url text;
  service_key text;
begin
  -- Är vi ens på Supabase? CI:s stubb i ci.yml skapar anon/authenticated/
  -- service_role men inte supabase_admin, så frånvaron av den rollen är det
  -- säkraste tecknet på att det här är en vanlig Postgres.
  --
  -- Medvetet ingen `exception when others` någonstans i den här filen: det är
  -- precis den mekanismen som ger grönt bygge över en automatik som aldrig går.
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise notice 'Inte Supabase — hoppar över schemaläggningen av Planday-synken.';
    return;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron är inte aktiverad. Slå på den i Dashboard → Database → Extensions och kör migrationen igen.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net är inte aktiverad. Slå på den i Dashboard → Database → Extensions och kör migrationen igen.';
  end if;

  -- Vault är där Supabase förvarar hemligheter som databasen behöver. Nyckeln
  -- får inte stå i klartext i en migration — den ligger i git för alltid.
  select decrypted_secret into projekt_url
    from vault.decrypted_secrets where name = 'projekt_url';
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if projekt_url is null or service_key is null then
    raise exception 'Lägg först in hemligheterna: select vault.create_secret(''https://<ref>.supabase.co'', ''projekt_url''); och samma för ''service_role_key''.';
  end if;

  -- cron.schedule är en upsert på jobbnamn: körs migrationen igen blir det ett
  -- jobb, inte två. cron.unschedule behövs alltså inte — och den KASTAR när
  -- jobbet inte finns, så ett naket anrop hade fällt migrationen mot en färsk
  -- databas.
  --
  -- 03:00 UTC = 04:00 eller 05:00 svensk tid, efter att nattpassen är slut.
  -- Inre dollarcitat måste ha en egen tagg; med $$ i båda avslutas DO-blocket
  -- mitt i strängen.
  perform cron.schedule('planday-synk', '0 3 * * *', format(
    $jobb$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || %L),
      body    := '{}'::jsonb
    )
    $jobb$,
    projekt_url || '/functions/v1/planday-synk',
    service_key
  ));

  -- cron.job_run_details växer obegränsat. En vecka räcker för att felsöka en
  -- natt som inte gick.
  perform cron.schedule('planday-synk-rensa-logg', '30 3 * * *',
    $rensa$delete from cron.job_run_details where end_time < now() - interval '7 days'$rensa$);

  raise notice 'Planday-synken är schemalagd 03:00 UTC.';
end $mig$;
