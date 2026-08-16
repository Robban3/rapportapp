-- =====================================================================
-- Rapportapp — databasschema (Supabase / PostgreSQL)
-- Kör detta i Supabase SQL Editor för att skapa tabeller, relationer,
-- en vy för sammanställd rapport och seed-data.
-- =====================================================================

-- ---------- Objekt (t.ex. hotell) ----------
create table if not exists objekt (
  id           uuid primary key default gen_random_uuid(),
  namn         text not null,
  kod          text unique,                 -- kort kod, t.ex. "DRAKEN"
  kund_epost   text,                         -- dit rapporten skickas
  aktiv        boolean not null default true,
  skapad_at    timestamptz not null default now()
);

-- ---------- Personal (värdar, ordningsvakter, garderob) ----------
create table if not exists personal (
  id           uuid primary key default gen_random_uuid(),
  namn         text not null,
  initialer    text not null,                -- signatur i rapporten, t.ex. "ZÄEM"
  roll         text not null default 'Värd', -- Värd | Ordningsvakt | Garderob | Admin
  kod          text not null unique,         -- personlig inloggningskod (PIN)
  aktiv        boolean not null default true,
  skapad_at    timestamptz not null default now()
);

-- ---------- Koppling personal <-> objekt (vem som FÅR bemannas var) ----------
-- En person ser BARA de objekt hen är kopplad till. Kopplingen ger däremot
-- ingen åtkomst till en passlogg i sig — det gör bemanningen i pass_personal.
create table if not exists personal_objekt (
  personal_id  uuid not null references personal(id) on delete cascade,
  objekt_id    uuid not null references objekt(id) on delete cascade,
  primary key (personal_id, objekt_id)
);

-- ---------- Pass (ett arbetspass på ett objekt en viss dag) ----------
create table if not exists pass (
  id           uuid primary key default gen_random_uuid(),
  objekt_id    uuid not null references objekt(id) on delete cascade,
  datum        date not null,
  starttid     time,
  sluttid      time,
  status       text not null default 'oppet', -- oppet | granskas | skickat
  skickad_at   timestamptz,
  skapad_at    timestamptz not null default now(),
  unique (objekt_id, datum)
);

-- ---------- Bemanning: vilka som jobbar passet ----------
-- Sätts från adminpanelen (Bemanning) och är appens åtkomstkontroll för
-- passloggen: bara den som står här kommer åt loggen för objektet det datumet.
-- Syns också som roster i rapportens topp.
create table if not exists pass_personal (
  pass_id      uuid not null references pass(id) on delete cascade,
  personal_id  uuid not null references personal(id) on delete cascade,
  roll         text,
  tid_in       text,                          -- fritext, stöder t.ex. "14:30"
  tid_ut       text,
  primary key (pass_id, personal_id)
);
-- Objektlistan frågar "var är jag bemannad idag?" per inloggning.
create index if not exists pass_personal_personal on pass_personal (personal_id);

-- ---------- Inlägg (fria anteckningar i passloggen) ----------
create table if not exists inlagg (
  id           uuid primary key default gen_random_uuid(),
  pass_id      uuid not null references pass(id) on delete cascade,
  personal_id  uuid not null references personal(id),
  tid          text not null,                 -- fritext: "18:45" eller "20:45-21:30"
  sortnyckel   int  not null default 0,       -- minuter från midnatt, för sortering
  meddelande   text not null,
  incident_typ text,                          -- null | 'hjalp_lamna' | 'ombads_lamna'
                                              -- | 'stannade_utanfor' | 'nekad_alder' | 'info_alkohol'
  last         boolean not null default true, -- låst efter sparande (spårbarhet)
  skapad_at    timestamptz not null default now()
);
create index if not exists inlagg_pass_sort on inlagg (pass_id, sortnyckel, skapad_at);

-- ---------- Vy: sammanställd rapport i tidsordning ----------
create or replace view rapport_inlagg as
  select i.pass_id, i.tid, i.meddelande, i.incident_typ, i.skapad_at,
         p.initialer as signatur, p.namn as personal_namn
  from inlagg i
  join personal p on p.id = i.personal_id
  order by i.sortnyckel, i.skapad_at;

-- ---------- Statistik per pass (räknas från taggade inlägg) ----------
create or replace view pass_statistik as
  select pass_id,
         count(*) filter (where incident_typ = 'hjalp_lamna')      as hjalp_lamna,
         count(*) filter (where incident_typ = 'ombads_lamna')     as ombads_lamna,
         count(*) filter (where incident_typ = 'stannade_utanfor') as stannade_utanfor,
         count(*) filter (where incident_typ = 'nekad_alder')      as nekad_alder,
         count(*) filter (where incident_typ = 'info_alkohol')     as info_alkohol
  from inlagg
  group by pass_id;

-- =====================================================================
-- RLS (Row Level Security) — utgångspunkt.
--
-- OBS: scaffolden loggar in med personlig kod via appens datalager och
-- filtrerar i frågan. Det betyder att bemanningsspärren i dag bara finns i
-- klienten — den som kan anropa API:t direkt kommer förbi den. Vill ni att
-- "bara bemannad personal ser loggen" ska hålla på riktigt måste den
-- upprätthållas här nere. Exemplen är avstängda tills ni har Supabase Auth.
-- =====================================================================
-- alter table objekt enable row level security;
-- create policy "personal ser kopplade objekt" on objekt for select
--   using (exists (
--     select 1 from personal_objekt po
--     join personal pe on pe.id = po.personal_id
--     where po.objekt_id = objekt.id and pe.auth_user_id = auth.uid()
--   ));
--
-- alter table inlagg enable row level security;
-- create policy "bemannad personal ser passloggen" on inlagg for select
--   using (exists (
--     select 1 from pass_personal pp
--     join personal pe on pe.id = pp.personal_id
--     where pp.pass_id = inlagg.pass_id and pe.auth_user_id = auth.uid()
--   ));
-- create policy "bemannad personal skriver i passloggen" on inlagg for insert
--   with check (exists (
--     select 1 from pass_personal pp
--     join personal pe on pe.id = pp.personal_id
--     where pp.pass_id = inlagg.pass_id and pe.auth_user_id = auth.uid()
--   ));
--
-- Bemanningen sätts bara av admin — personal ska aldrig kunna skriva sig
-- själv till ett pass:
-- alter table pass_personal enable row level security;
-- create policy "bara admin bemannar" on pass_personal for all
--   using (exists (
--     select 1 from personal pe where pe.auth_user_id = auth.uid() and pe.roll = 'Admin'
--   ));

-- =====================================================================
-- SEED — exempeldata (Clarion Draken)
-- =====================================================================
insert into objekt (namn, kod, kund_epost) values
  ('Clarion Draken Hotel', 'DRAKEN', 'drift@clariondraken.se'),
  ('Grand Central', 'GRAND', 'reception@grandcentral.se'),
  ('Scandic Väst', 'SCVAST', 'drift@scandicvast.se')
on conflict (kod) do nothing;

insert into personal (namn, initialer, roll, kod) values
  ('Zäem',  'ZÄEM', 'Värd',         '1111'),
  ('Varo',  'VARO', 'Värd',         '2222'),
  ('Pesa',  'PESA', 'Ordningsvakt', '3333'),
  ('Mobo',  'MOBO', 'Ordningsvakt', '4444'),
  ('Admin', 'ADM',  'Admin',        '0000')
on conflict (kod) do nothing;

-- Koppla all personal (utom admin sköts i panelen) till Clarion Draken:
insert into personal_objekt (personal_id, objekt_id)
select pe.id, ob.id from personal pe cross join objekt ob
where ob.kod = 'DRAKEN' and pe.initialer in ('ZÄEM','VARO','PESA','MOBO')
on conflict do nothing;
