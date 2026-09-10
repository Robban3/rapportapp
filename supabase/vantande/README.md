# Migrationer som väntar på en förutsättning

Supabases GitHub-integration kör allt under `supabase/migrations/` vid varje
push till main. En migration som faller där **stoppar hela kön** — senare
migrationer körs inte förrän felet är åtgärdat.

Filerna här är färdiga och testade, men kräver att något slås på i dashboarden
först. Flytta in dem i `supabase/migrations/` när förutsättningen är uppfylld;
de körs vid nästa push.

## `20260910140000_planday_cron.sql`

Schemalägger den nattliga Planday-synken med pg_cron.

Migrationen **kastar med flit** om pg_cron saknas i stället för att hoppa över
tyst. Ett tyst överhopp hade gett ett grönt bygge över en automatik som aldrig
går — och den sortens fel upptäcks först när en värd står utan pass.

Innan den flyttas in:

1. **Dashboard → Database → Extensions**: slå på `pg_cron` och `pg_net`.
2. **SQL editor**, en gång:

   ```sql
   select vault.create_secret('https://<ditt-ref>.supabase.co', 'projekt_url');
   select vault.create_secret('<service_role_key>', 'service_role_key');
   ```

   Nyckeln får inte stå i migrationen — den ligger kvar i git för alltid.

3. Kontrollera efteråt att jobbet faktiskt finns. En grön migration säger
   ingenting om att det går:

   ```sql
   select jobname, schedule, active from cron.job;
   select status, start_time, return_message
     from cron.job_run_details order by start_time desc limit 10;
   ```
