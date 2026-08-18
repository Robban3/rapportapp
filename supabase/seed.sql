-- Demodata för lokal utveckling (`supabase db reset`). Körs INTE mot
-- produktionsprojektet — GitHub-integrationen kör bara migrations.
--
-- Inloggningskonton skapas inte här: lösenordshashning i auth.users är
-- Supabase-internt och formatet ändras mellan versioner. Skapa användarna i
-- Studio (Authentication → Users → Add user) med e-postadresserna nedan, så
-- knyter triggern ihop dem med personalen automatiskt.

-- kund_epost är borta sedan objekten fick flera mottagare. Seeden pekade kvar
-- på den kolumnen, så `supabase db reset` avbröt direkt med "column does not
-- exist" och lämnade databasen utan demodata.
insert into objekt (namn, kod, rapportmottagare, standard_starttid, standard_sluttid, kontaktperson, kontakt_telefon) values
  ('Clarion Draken Hotel', 'DRAKEN', array['drift@clariondraken.se','reception@clariondraken.se'], '14:30', '03:00', 'Obie Nyström', '070-123 45 67'),
  ('Grand Central',        'GRAND',  array['reception@grandcentral.se'], '22:00', '06:00', null, null),
  ('Scandic Väst',         'SCVAST', array['drift@scandicvast.se'], null, null, null, null)
on conflict (kod) do nothing;

insert into personal (namn, initialer, roll, epost) values
  ('Zäem',  'ZÄEM', 'Värd',         'zaem@example.se'),
  ('Varo',  'VARO', 'Värd',         'varo@example.se'),
  ('Pesa',  'PESA', 'Ordningsvakt', 'pesa@example.se'),
  ('Mobo',  'MOBO', 'Ordningsvakt', 'mobo@example.se'),
  ('Admin', 'ADM',  'Admin',        'admin@example.se')
on conflict do nothing;

-- Alla utom admin kopplas till Clarion Draken; admin till alla objekt.
insert into personal_objekt (personal_id, objekt_id)
select pe.id, ob.id from personal pe cross join objekt ob
 where (ob.kod = 'DRAKEN' and pe.initialer in ('ZÄEM','VARO','PESA','MOBO'))
    or pe.roll = 'Admin'
on conflict do nothing;

-- Veckoschema: Clarion Draken bemannas fredag och lördag, så
-- "Skapa pass ur schemat" har något att skapa direkt.
insert into objekt_schema (objekt_id, veckodag, starttid, sluttid)
select ob.id, v.dag, '14:30', '03:00'
  from objekt ob, (values (5), (6)) as v(dag)
 where ob.kod = 'DRAKEN'
on conflict (objekt_id, veckodag) do nothing;

insert into schema_personal (schema_id, personal_id, roll, tid_in, tid_ut)
select s.id, pe.id,
       case when pe.roll = 'Värd' then 'Värd' else 'Ordningsvakt' end,
       case when pe.roll = 'Värd' then '14:30' else '20:00' end,
       case when pe.roll = 'Värd' then '23:30' else '03:00' end
  from objekt_schema s
  join objekt ob on ob.id = s.objekt_id and ob.kod = 'DRAKEN'
  join personal pe on pe.initialer in ('ZÄEM', 'MOBO')
on conflict do nothing;
