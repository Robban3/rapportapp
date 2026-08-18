-- =====================================================================
-- Grundschema: objekt, personal, pass, bemanning och inlägg.
--
-- `if not exists` genomgående, så migrationen är ofarlig även i ett projekt
-- där schema.sql redan körts för hand i SQL-editorn.
-- =====================================================================

-- ---------- Objekt (t.ex. hotell) ----------
create table if not exists objekt (
  id           uuid primary key default gen_random_uuid(),
  namn         text not null,
  kod          text unique,                  -- kort kod, t.ex. "DRAKEN"
  kund_epost   text,                          -- dit rapporten skickas
  aktiv        boolean not null default true,
  skapad_at    timestamptz not null default now()
);

-- ---------- Personal (värdar, ordningsvakter, garderob) ----------
create table if not exists personal (
  id           uuid primary key default gen_random_uuid(),
  namn         text not null,
  initialer    text not null,                 -- signatur i rapporten, t.ex. "ZÄEM"
  roll         text not null default 'Värd',  -- Värd | Ordningsvakt | Garderob | Admin
  kod          text unique,                   -- personlig PIN; tas bort i auth-migrationen
  aktiv        boolean not null default true,
  skapad_at    timestamptz not null default now()
);

-- ---------- Koppling personal <-> objekt (vem som FÅR bemannas var) ----------
-- Ger i sig ingen åtkomst till en passlogg — det gör bemanningen nedan.
create table if not exists personal_objekt (
  personal_id  uuid not null references personal(id) on delete cascade,
  objekt_id    uuid not null references objekt(id) on delete cascade,
  primary key (personal_id, objekt_id)
);

-- ---------- Pass (ett arbetspass på ett objekt en viss dag) ----------
-- Passet är daterat sin STARTDAG. Ett pass 22:00-06:00 daterat den 16:e
-- slutar kl 06:00 den 17:e, men hela natten hör till den 16:e:s rapport.
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
-- Sätts från adminpanelen och är appens åtkomstkontroll för passloggen.
create table if not exists pass_personal (
  pass_id      uuid not null references pass(id) on delete cascade,
  personal_id  uuid not null references personal(id) on delete cascade,
  roll         text,
  tid_in       text,
  tid_ut       text,
  primary key (pass_id, personal_id)
);
create index if not exists pass_personal_personal on pass_personal (personal_id);

-- ---------- Inlägg (fria anteckningar i passloggen) ----------
create table if not exists inlagg (
  id           uuid primary key default gen_random_uuid(),
  pass_id      uuid not null references pass(id) on delete cascade,
  personal_id  uuid not null references personal(id),
  tid          text not null,                 -- "18:45" eller "20:45-21:30"
  sortnyckel   int  not null default 0,       -- minuter från passets start
  meddelande   text not null,
  incident_typ text,
  last         boolean not null default true, -- låst efter sparande (spårbarhet)
  skapad_at    timestamptz not null default now()
);
create index if not exists inlagg_pass_sort on inlagg (pass_id, sortnyckel, skapad_at);

-- ---------- Vyer ----------
-- security_invoker gör att RLS-policyerna gäller den som frågar, inte den som
-- skapade vyn. Utan det vore vyerna en väg runt hela åtkomstkontrollen.
create or replace view rapport_inlagg with (security_invoker = true) as
  select i.pass_id, i.tid, i.meddelande, i.incident_typ, i.skapad_at,
         p.initialer as signatur, p.namn as personal_namn
  from inlagg i
  join personal p on p.id = i.personal_id
  order by i.sortnyckel, i.skapad_at;

create or replace view pass_statistik with (security_invoker = true) as
  select pass_id,
         count(*) filter (where incident_typ = 'hjalp_lamna')      as hjalp_lamna,
         count(*) filter (where incident_typ = 'ombads_lamna')     as ombads_lamna,
         count(*) filter (where incident_typ = 'stannade_utanfor') as stannade_utanfor,
         count(*) filter (where incident_typ = 'nekad_alder')      as nekad_alder,
         count(*) filter (where incident_typ = 'info_alkohol')     as info_alkohol
  from inlagg
  group by pass_id;
