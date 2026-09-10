#!/usr/bin/env bash
# Prövar synka_planday mot en riktig Postgres. Varje fall körs i en egen
# transaktion som rullas tillbaka, så ordningen mellan dem spelar ingen roll.
set -uo pipefail
# Anslutningen tas från PG*-variablerna (CI sätter dem; lokalt: PGHOST/PGPORT).

OK=0; FEL=0
kolla() { # kolla "namn" "sql vars SISTA boolean-rad är påståendet"
  local namn="$1" sql="$2" allt ut
  allt=$(psql -tAX -c "$sql" 2>&1)
  # Bara raderna som är exakt t eller f är påståenden; resten är BEGIN,
  # INSERT 0 1, funktionsresultat och ROLLBACK.
  ut=$(printf '%s\n' "$allt" | grep -x '[tf]' | tail -1)
  if [ "$ut" = "t" ]; then OK=$((OK+1)); printf '  \033[32m✓\033[0m %s\n' "$namn"
  else
    FEL=$((FEL+1)); printf '  \033[31m✗\033[0m %s\n' "$namn"
    printf '%s\n' "$allt" | sed 's/^/      /'
  fi
}

DRAKEN=$(psql -tAXc "select id from objekt where kod='DRAKEN'")
ZAEM=$(psql -tAXc "select id from personal where initialer='ZÄEM'")
PESA=$(psql -tAXc "select id from personal where initialer='PESA'")
ADMIN_UID='00000000-0000-0000-0000-000000000001'

# Admin behöver ett auth-konto för att ar_admin() ska svara ja. Triggern
# koppla_personal_till_auth kopplar det till seedens Admin på e-posten.
psql -qtAXc "insert into auth.users (id, email) values ('$ADMIN_UID','admin@example.se')
             on conflict (email) do nothing" >/dev/null

echo "── synka_planday"

kolla "skapar pass och bemanning ur Planday-nyttolasten" "
begin;
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"sluttid\":\"06:00\",
    \"bemanning\":[{\"planday_shift_id\":901,\"planday_employee_id\":11,\"epost\":\"zaem@example.se\",\"namn\":\"Zäem\",
                   \"roll\":\"Värd\",\"tid_in\":\"22:00\",\"tid_ut\":\"06:00\"}]}]'::jsonb);
  select (select count(*) from pass where objekt_id='$DRAKEN' and datum='2026-09-11') = 1
     and (select count(*) from pass_personal pp join pass p on p.id=pp.pass_id
           where p.datum='2026-09-11' and pp.personal_id='$ZAEM' and pp.planday_shift_id=901) = 1;
rollback;"

kolla "lär in planday_employee_id vid matchning på e-post" "
begin;
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"sluttid\":\"06:00\",
    \"bemanning\":[{\"planday_shift_id\":901,\"planday_employee_id\":11,\"epost\":\"zaem@example.se\"}]}]'::jsonb);
  select planday_employee_id = 11 from personal where id='$ZAEM';
rollback;"

kolla "är idempotent — andra körningen dubblerar inget" "
begin;
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"sluttid\":\"06:00\",
    \"bemanning\":[{\"planday_shift_id\":901,\"planday_employee_id\":11,\"epost\":\"zaem@example.se\"}]}]'::jsonb);
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"sluttid\":\"06:00\",
    \"bemanning\":[{\"planday_shift_id\":901,\"planday_employee_id\":11,\"epost\":\"zaem@example.se\"}]}]'::jsonb);
  select (select count(*) from pass where objekt_id='$DRAKEN' and datum='2026-09-11') = 1
     and (select count(*) from pass_personal pp join pass p on p.id=pp.pass_id where p.datum='2026-09-11') = 1;
rollback;"

kolla "femton shifts samma dygn blir ETT pass med femton rader bemanning" "
begin;
  select synka_planday('$DRAKEN'::uuid, (
    select jsonb_build_array(jsonb_build_object(
      'datum','2026-09-12','starttid','18:00','sluttid','03:00',
      'bemanning', jsonb_agg(jsonb_build_object(
        'planday_shift_id', 1000+g, 'planday_employee_id', 500+g,
        'epost', 'evenemang'||g||'@example.se', 'namn','Extra '||g))))
    from generate_series(1,15) g));
  select (select count(*) from pass where objekt_id='$DRAKEN' and datum='2026-09-12') = 1
     and (select count(*) from planday_omatchad) = 15;
rollback;"

kolla "omatchad personal hamnar i planday_omatchad i stället för att tystna" "
begin;
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",
    \"bemanning\":[{\"planday_shift_id\":902,\"planday_employee_id\":77,\"epost\":\"okand@example.se\",\"namn\":\"Okänd\"}]}]'::jsonb);
  select count(*) = 1 from planday_omatchad where planday_employee_id=77 and epost='okand@example.se';
rollback;"

kolla "omatchad rensas när personen väl går att koppla" "
begin;
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",
    \"bemanning\":[{\"planday_shift_id\":902,\"planday_employee_id\":77,\"epost\":\"okand@example.se\"}]}]'::jsonb);
  update personal set epost='okand@example.se' where id='$PESA';
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",
    \"bemanning\":[{\"planday_shift_id\":902,\"planday_employee_id\":77,\"epost\":\"okand@example.se\"}]}]'::jsonb);
  select count(*) = 0 from planday_omatchad where planday_employee_id=77;
rollback;"

echo "── det som får kosta en logg om det brister"

kolla "rör ALDRIG ett skickat pass" "
begin;
  insert into pass (objekt_id, datum, starttid, sluttid, status)
    values ('$DRAKEN','2026-09-11','20:00','02:00','skickat');
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"sluttid\":\"06:00\",
    \"bemanning\":[{\"planday_shift_id\":901,\"planday_employee_id\":11,\"epost\":\"zaem@example.se\"}]}]'::jsonb);
  select starttid = '20:00'::time and (select count(*) from pass_personal pp where pp.pass_id = pass.id) = 0
    from pass where objekt_id='$DRAKEN' and datum='2026-09-11';
rollback;"

kolla "rör ALDRIG ett låst pass" "
begin;
  insert into pass (objekt_id, datum, starttid, status)
    values ('$DRAKEN','2026-09-11','20:00','last');
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",
    \"bemanning\":[{\"planday_shift_id\":901,\"planday_employee_id\":11,\"epost\":\"zaem@example.se\"}]}]'::jsonb);
  select starttid = '20:00'::time from pass where objekt_id='$DRAKEN' and datum='2026-09-11';
rollback;"

kolla "tar ALDRIG bort en manuellt tillagd person" "
begin;
  insert into pass (objekt_id, datum, starttid) values ('$DRAKEN','2026-09-11','22:00');
  insert into pass_personal (pass_id, personal_id, roll)
    select id, '$PESA', 'Ordningsvakt' from pass where objekt_id='$DRAKEN' and datum='2026-09-11';
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",
    \"bemanning\":[{\"planday_shift_id\":901,\"planday_employee_id\":11,\"epost\":\"zaem@example.se\"}]}]'::jsonb);
  select count(*) = 1 from pass_personal pp join pass p on p.id=pp.pass_id
   where p.datum='2026-09-11' and pp.personal_id='$PESA';
rollback;"

kolla "tar ALDRIG bort en manuellt tillagd person — inte ens när passet står osökt" "
begin;
  insert into pass (objekt_id, datum, starttid) values ('$DRAKEN','2026-09-11','22:00');
  insert into pass_personal (pass_id, personal_id, roll)
    select id, '$PESA', 'Ordningsvakt' from pass where objekt_id='$DRAKEN' and datum='2026-09-11';
  -- Tom bemanning: NULL = any('{}') är FALSE, inte NULL. Utan vakten
  -- planday_shift_id is not null raderas raden här.
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"bemanning\":[]}]'::jsonb);
  select count(*) = 1 from pass_personal pp join pass p on p.id=pp.pass_id
   where p.datum='2026-09-11' and pp.personal_id='$PESA';
rollback;"

kolla "tar ALDRIG bort någon som skrivit i loggen" "
begin;
  insert into pass (objekt_id, datum, starttid) values ('$DRAKEN','2026-09-11','22:00');
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",
    \"bemanning\":[{\"planday_shift_id\":903,\"planday_employee_id\":22,\"epost\":\"pesa@example.se\"}]}]'::jsonb);
  insert into inlagg (pass_id, personal_id, tid, meddelande)
    select id, '$PESA', '23:00', 'Rond utan anmärkning.' from pass where objekt_id='$DRAKEN' and datum='2026-09-11';
  -- Pesa har lämnat ifrån sig passet i Planday: nyttolasten nämner hen inte längre
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"bemanning\":[]}]'::jsonb);
  select count(*) = 1 from pass_personal pp join pass p on p.id=pp.pass_id
   where p.datum='2026-09-11' and pp.personal_id='$PESA';
rollback;"

kolla "tar bort den som lämnat ifrån sig passet och inte skrivit något" "
begin;
  insert into pass (objekt_id, datum, starttid) values ('$DRAKEN','2026-09-11','22:00');
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",
    \"bemanning\":[{\"planday_shift_id\":903,\"planday_employee_id\":22,\"epost\":\"pesa@example.se\"}]}]'::jsonb);
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"bemanning\":[]}]'::jsonb);
  select count(*) = 0 from pass_personal pp join pass p on p.id=pp.pass_id
   where p.datum='2026-09-11' and pp.personal_id='$PESA';
rollback;"

kolla "raderar ALDRIG ett pass som försvunnit ur Planday" "
begin;
  insert into pass (objekt_id, datum, starttid) values ('$DRAKEN','2026-09-11','22:00');
  select synka_planday('$DRAKEN'::uuid, '[]'::jsonb);
  select count(*) = 1 from pass where objekt_id='$DRAKEN' and datum='2026-09-11';
rollback;"

kolla "uppdaterar tider när Planday flyttat passet" "
begin;
  insert into pass (objekt_id, datum, starttid, sluttid) values ('$DRAKEN','2026-09-11','22:00','06:00');
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"20:00\",\"sluttid\":\"04:00\",\"bemanning\":[]}]'::jsonb);
  select starttid='20:00'::time and sluttid='04:00'::time from pass where objekt_id='$DRAKEN' and datum='2026-09-11';
rollback;"

echo "── härdning, båda hållen"

kolla "authenticated kan INTE anropa synka_planday" "
begin;
  set local role authenticated;
  set local request.jwt.claims = '{\"sub\":\"$ADMIN_UID\"}';
  do \$\$ begin
    perform synka_planday('$DRAKEN'::uuid, '[]'::jsonb);
    raise exception 'HÅL: synka_planday var körbar för authenticated';
  exception when insufficient_privilege then null; end \$\$;
  select true;
rollback;"

kolla "admins egen väg genom skapa_pass_fran_schema går fortfarande igenom" "
begin;
  set local role authenticated;
  set local request.jwt.claims = '{\"sub\":\"$ADMIN_UID\"}';
  select count(*) > 0 from skapa_pass_fran_schema(14);
rollback;"

kolla "generatorn hoppar över objekt som styrs av Planday" "
begin;
  update objekt set planday_department_id = 4711 where id='$DRAKEN';
  set local role authenticated;
  set local request.jwt.claims = '{\"sub\":\"$ADMIN_UID\"}';
  select count(*) = 0 from skapa_pass_fran_schema(14) where objekt_id='$DRAKEN';
rollback;"

kolla "synkloggen skrivs och syns bara för admin" "
begin;
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"bemanning\":[]}]'::jsonb);
  set local role authenticated;
  set local request.jwt.claims = '{\"sub\":\"$ADMIN_UID\"}';
  select count(*) = 1 from planday_synk where objekt_id='$DRAKEN';
rollback;"

kolla "en värd ser INTE synkloggen" "
begin;
  select synka_planday('$DRAKEN'::uuid, '[{\"datum\":\"2026-09-11\",\"starttid\":\"22:00\",\"bemanning\":[]}]'::jsonb);
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000002','zaem@example.se')
    on conflict (email) do nothing;
  set local role authenticated;
  set local request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-000000000002\"}';
  select count(*) = 0 from planday_synk;
rollback;"

echo
printf 'Klart: \033[32m%d gröna\033[0m, \033[31m%d röda\033[0m\n' "$OK" "$FEL"
[ "$FEL" -eq 0 ]
