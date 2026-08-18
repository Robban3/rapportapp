-- Demodata för lokal utveckling (`supabase db reset`). Körs INTE mot
-- produktionsprojektet — GitHub-integrationen kör bara migrations.
--
-- Inloggningskonton skapas inte här: lösenordshashning i auth.users är
-- Supabase-internt och formatet ändras mellan versioner. Skapa användarna i
-- Studio (Authentication → Users → Add user) med e-postadresserna nedan, så
-- knyter triggern ihop dem med personalen automatiskt.

insert into objekt (namn, kod, kund_epost) values
  ('Clarion Draken Hotel', 'DRAKEN', 'drift@clariondraken.se'),
  ('Grand Central',        'GRAND',  'reception@grandcentral.se'),
  ('Scandic Väst',         'SCVAST', 'drift@scandicvast.se')
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
