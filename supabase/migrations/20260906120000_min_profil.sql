-- Rättar en regression från 20260905100200_atkomst.sql.
--
-- Den migrationen drog in SELECT på `personal` till kolumnerna
-- (id, namn, initialer, roll, aktiv) för att stänga att vilken värd som helst
-- kunde läsa hela personalregistret med e-post och roller. Rätt beslut, fel
-- antagande: kommentaren där påstår att RLS-predikat får läsa auth_user_id
-- även utan kolumnrättighet, och drar slutsatsen att appens frågor klarar sig.
--
-- Det gäller policyernas EGNA predikat. Ett filter som klienten skickar med är
-- en vanlig kolumnreferens, och kolumnrättigheter i Postgres omfattar varje
-- referens — WHERE-villkor lika mycket som det som returneras.
--
-- Följden blev att `select ... from personal where auth_user_id = $1`, alltså
-- frågan som hämtar den inloggades profil, nekades med 42501. Ingen kunde logga
-- in. Samma filter satt i admin-kontrollen i båda Edge Functions, där felet
-- dessutom sväljdes och blev ett vilseledande "Bara administratörer får ...".
--
-- Lösningen är inte att ge tillbaka kolumnen, utan att sluta filtrera på den.
-- auth.uid() finns redan serverside.

create or replace function public.min_profil()
returns table (id uuid, namn text, initialer text, roll text, aktiv boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.namn, p.initialer, p.roll, p.aktiv
    from personal p
   where p.auth_user_id = auth.uid() and p.aktiv
$$;

grant execute on function public.min_profil() to authenticated;
