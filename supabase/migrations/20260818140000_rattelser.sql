-- =====================================================================
-- Rättelser.
--
-- inlagg låstes tidigare helt: inga update- eller delete-policyer, och inga
-- grants. Det bevarade historiken men gjorde ett felskrivet rumsnummer
-- permanent — och rapporten går till kund.
--
-- En rättelse är därför en NY rad som pekar på originalet. Båda finns kvar,
-- originalet stryks i rapporten. Historien skrivs aldrig om; den växer.
-- =====================================================================

alter table inlagg add column if not exists rattar_id uuid references inlagg(id) on delete restrict;

-- Ett inlägg får rättas en gång. Kedjor av rättelser blir omöjliga att läsa
-- i en rapport, och "vilken gäller?" ska aldrig vara en fråga.
create unique index if not exists inlagg_rattar_unik on inlagg (rattar_id) where rattar_id is not null;
create index if not exists inlagg_rattar on inlagg (rattar_id);

/* Rättelsen måste höra till samma pass som originalet, och ett inlägg får
   inte rätta sig självt. Utan detta kunde en rättelse peka in i ett annat
   objekts rapport. */
create or replace function public.giltig_rattelse(p_pass_id uuid, p_rattar_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_rattar_id is null
      or exists (
           select 1 from inlagg orig
            where orig.id = p_rattar_id
              and orig.pass_id = p_pass_id
              and orig.rattar_id is null    -- rätta inte en rättelse
         )
$$;

grant execute on function public.giltig_rattelse to authenticated;

-- Insert-policyn ersätts: samma krav som förut, plus giltig rättelse. Admin
-- får skriva rättelser även på pass hen inte är bemannad på — felet upptäcks
-- oftast vid granskningen, när värden gått hem. Rättelsen signeras av den
-- som skriver den, så det syns vem som ändrade vad.
drop policy if exists "bemannad personal skriver i passloggen" on inlagg;

create policy "bemannad personal skriver i passloggen" on inlagg
  for insert to authenticated with check (
    personal_id = aktuell_personal_id()      -- ingen skriver i annans namn
    and (ar_bemannad(pass_id) or ar_admin())
    and pass_oppet(pass_id)                  -- en låst rapport växer inte
    and giltig_rattelse(pass_id, rattar_id)
  );
