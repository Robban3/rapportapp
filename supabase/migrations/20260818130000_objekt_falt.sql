-- =====================================================================
-- Objektet bär nu det som behövs för att lägga upp ett pass och för att
-- veta vart rapporten ska.
-- =====================================================================

-- Standardtider. Passets tider styr både sorteringen av inlägg och när
-- loggen öppnar och stänger, så de ska inte knappas in på nytt varje kväll.
alter table objekt add column if not exists standard_starttid time;
alter table objekt add column if not exists standard_sluttid  time;

-- Vem värden ringer kl 02:00, och vad som gäller just här.
alter table objekt add column if not exists kontaktperson   text;
alter table objekt add column if not exists kontakt_telefon text;
alter table objekt add column if not exists instruktioner   text;

-- Rapporten går sällan till en enda adress: drift vill ha den, receptionen
-- vill ha den, ibland hotelldirektören. En text-kolumn tvingade fram
-- kommaseparerade listor som ingen kunde validera.
alter table objekt add column if not exists rapportmottagare text[] not null default '{}';

-- Flytta över befintligt värde innan den gamla kolumnen försvinner.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'objekt' and column_name = 'kund_epost'
  ) then
    update objekt
       set rapportmottagare = array[kund_epost]
     where kund_epost is not null
       and btrim(kund_epost) <> ''
       and cardinality(rapportmottagare) = 0;

    alter table objekt drop column kund_epost;
  end if;
end $$;
