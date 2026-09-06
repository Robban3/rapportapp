// Låser passet och mejlar rapporten till objektets mottagare.
//
// Ordningen är medveten: passet låses FÖRST, rapporten renderas ur det låsta
// tillståndet, och sedan skickas mejlet. Tvärtom hade ett inlägg som skrivs i
// samma sekund kunnat hamna i loggen men utanför rapporten — tyst och
// permanent.
//
// Låst och skickat är två olika tillstånd, och det är hela poängen. Passet
// sätts till `last` innan mejlet går iväg och blir `skickat` först när Resend
// svarat 2xx. Går det fel står passet kvar som `last` med orsaken sparad i
// utskick_fel, och administratören ser "Låst — ej skickad" i listan. Tidigare
// sattes `skickat` direkt, så ett bortfall var omöjligt att skilja från en
// levererad rapport.
//
// RESEND_API_KEY sätts som secret:
//   supabase secrets set RESEND_API_KEY=re_...
// (SUPABASE_URL, SUPABASE_ANON_KEY och SUPABASE_SERVICE_ROLE_KEY injiceras
// automatiskt av plattformen och kan inte sättas för hand.)

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { renderaHtml, textVersion, amne, type RapportData } from './rapport-html.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const svar = (status: number, kropp: unknown) =>
  new Response(JSON.stringify(kropp), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const STATS_NYCKLAR = ['hjalp_lamna', 'ombads_lamna', 'stannade_utanfor', 'nekad_alder', 'info_alkohol']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return svar(405, { fel: 'Endast POST.' })

  const url = Deno.env.get('SUPABASE_URL')
  const anonNyckel = Deno.env.get('SUPABASE_ANON_KEY')
  const resendNyckel = Deno.env.get('RESEND_API_KEY')
  // Ingen tyst fallback på Resends sandbox-adress: den levererar bara till
  // kontoägaren, så rapporten hade sett ut att gå iväg utan att nå kunden.
  const avsandare = Deno.env.get('RAPPORT_AVSANDARE')

  if (!url || !anonNyckel) return svar(500, { fel: 'Funktionen saknar konfiguration.' })
  if (!resendNyckel) {
    return svar(500, { fel: 'RESEND_API_KEY är inte satt. Sätt den under Edge Function Secrets.' })
  }
  if (!avsandare) {
    return svar(500, { fel: 'RAPPORT_AVSANDARE är inte satt. Sätt den under Edge Function Secrets.' })
  }

  const auth = req.headers.get('Authorization')
  if (!auth) return svar(401, { fel: 'Du måste vara inloggad.' })

  // Klienten agerar som anroparen och lyder RLS hela vägen. Ingen
  // service_role-nyckel behövs: admin får redan läsa och låsa passet.
  const somAnroparen = createClient(url, anonNyckel, { global: { headers: { Authorization: auth } } })

  const { data: { user }, error: userFel } = await somAnroparen.auth.getUser()
  if (userFel || !user) return svar(401, { fel: 'Din session har gått ut. Logga in igen.' })

  // ar_admin() kollar både roll och aktiv, serverside. Tidigare filtrerade
  // koden på auth_user_id, som ligger utanför kolumngranten — frågan nekades,
  // felet destrukturerades aldrig, och varje admin fick ett 403 som pekade på
  // fel orsak.
  const { data: arAdmin, error: rollFel } = await somAnroparen.rpc('ar_admin')

  if (rollFel) {
    console.error('kunde inte läsa rollen', { fel: rollFel.message })
    return svar(500, { fel: 'Kunde inte kontrollera din behörighet. Försök igen.' })
  }
  if (!arAdmin) {
    return svar(403, { fel: 'Bara administratörer får skicka rapporten.' })
  }

  let passId = ''
  let omskick = false
  try {
    const kropp = await req.json() as { passId?: string; omskick?: boolean }
    passId = String(kropp.passId || '')
    omskick = Boolean(kropp.omskick)
  } catch {
    return svar(400, { fel: 'Kunde inte läsa anropet.' })
  }
  if (!passId) return svar(400, { fel: 'Passet måste anges.' })

  const { data: pass } = await somAnroparen
    .from('pass').select('*, objekt:objekt_id ( * )').eq('id', passId).maybeSingle()
  if (!pass) return svar(404, { fel: 'Passet finns inte.' })

  const mottagare: string[] = pass.objekt?.rapportmottagare ?? []
  if (mottagare.length === 0) {
    return svar(400, { fel: 'Objektet saknar rapportmottagare. Lägg till adresser under Objekt.' })
  }

  // Ett omskick ska vara ett aktivt val. Annars räcker en dubbelklickning för
  // att kunden ska få samma rapport två gånger.
  if (pass.status === 'skickat' && !omskick) {
    return svar(409, { fel: 'Rapporten är redan skickad. Välj Skicka om för att skicka den igen.' })
  }

  // Lås först. Efter det kan loggen inte växa, och det som renderas nedan är
  // exakt det som kunden får.
  if (pass.status !== 'skickat') {
    const { error: lasFel } = await somAnroparen
      .from('pass').update({ status: 'last' }).eq('id', passId)
    if (lasFel) {
      console.error('skicka-rapport: kunde inte låsa passet', { passId, fel: lasFel.message })
      return svar(500, { fel: 'Kunde inte låsa passet. Inget skickades.' })
    }
  }

  // Felen kastas, de sväljs inte. Tidigare plockades bara `data` ut, så ett
  // RLS-avslag eller en timeout gav en tom lista — och rapporten mejlades utan
  // ett enda inlägg. En tom rapport till kund är sämre än ingen alls: den ser
  // ut som att natten var händelselös.
  const { data: roster, error: rosterFel } = await somAnroparen
    .from('pass_personal').select('*, personal:personal_id ( initialer, namn )').eq('pass_id', passId)

  const { data: inlagg, error: inlaggFel } = await somAnroparen
    .from('inlagg').select('*, personal:personal_id ( initialer )')
    .eq('pass_id', passId).order('sortnyckel').order('skapad_at')

  if (rosterFel || inlaggFel) {
    const orsak = (rosterFel ?? inlaggFel)!.message
    console.error('skicka-rapport: kunde inte läsa passet', { passId, fel: orsak })
    await somAnroparen.from('pass').update({ utskick_fel: 'Kunde inte läsa passet.' }).eq('id', passId)
    return svar(500, { fel: 'Kunde inte läsa passets innehåll. Rapporten skickades inte — passet är låst, välj Skicka om.' })
  }

  // Rättelser placeras vid sitt original och originalet märks — samma regel
  // som entriesForPass i appen. Rapporten får inte visa en annan ordning än
  // den administratören granskade.
  const rader = (inlagg ?? []).map((i) => ({ ...i, signatur: i.personal?.initialer }))
  const rattelser = new Map<string, typeof rader[number]>()
  for (const i of rader) if (i.rattar_id) rattelser.set(i.rattar_id, i)

  const ordnat: Array<typeof rader[number] & { ar_rattad: boolean }> = []
  for (const i of rader) {
    if (i.rattar_id) continue
    ordnat.push({ ...i, ar_rattad: rattelser.has(i.id) })
    const rattelse = rattelser.get(i.id)
    if (rattelse) ordnat.push({ ...rattelse, ar_rattad: false })
  }
  const med = new Set(ordnat.map((i) => i.id))
  for (const i of rader) if (!med.has(i.id)) ordnat.push({ ...i, ar_rattad: false })

  // Statistiken räknas här, inte i klienten: det som står i kundens rapport
  // ska komma från databasen. Ett rättat inlägg räknas inte — rättelsen bär
  // den gällande taggen.
  const stats: Record<string, number> = Object.fromEntries(STATS_NYCKLAR.map((k) => [k, 0]))
  for (const e of ordnat) {
    if (e.ar_rattad) continue
    if (e.incident_typ && stats[e.incident_typ] != null) stats[e.incident_typ]++
  }

  const data: RapportData = {
    objekt: pass.objekt,
    pass,
    roster: (roster ?? []).map((r) => ({ ...r, initialer: r.personal?.initialer, namn: r.personal?.namn })),
    entries: ordnat,
    stats
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendNyckel}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: avsandare,
      to: mottagare,
      subject: amne(data),
      html: renderaHtml(data),
      text: textVersion(data)
    })
  })

  if (!resp.ok) {
    // Passet står kvar som `last`. Orsaken sparas i databasen, inte bara i det
    // svar administratören råkar ha uppe — stänger hen fliken ska det ändå gå
    // att se att rapporten aldrig gick fram.
    const detalj = await resp.text().catch(() => '')
    console.error('skicka-rapport: Resend nekade', { passId, status: resp.status, detalj: detalj.slice(0, 500) })
    await somAnroparen
      .from('pass')
      .update({ utskick_fel: `Resend svarade ${resp.status}: ${detalj.slice(0, 200)}` })
      .eq('id', passId)
    return svar(502, {
      fel: 'Passet är låst, men mejlet gick inte iväg. Välj Skicka om när felet är åtgärdat.',
      detalj: detalj.slice(0, 300)
    })
  }

  const { id } = await resp.json().catch(() => ({ id: null }))

  // Först nu är rapporten levererad. utskick_id är Resends message-id och enda
  // handtaget för att spåra leveransen i efterhand.
  const { error: klarFel } = await somAnroparen
    .from('pass')
    .update({ status: 'skickat', skickad_at: new Date().toISOString(), utskick_id: id, utskick_fel: null })
    .eq('id', passId)

  if (klarFel) {
    console.error('skicka-rapport: mejlet gick iväg men passet kunde inte markeras', { passId, utskicksId: id, fel: klarFel.message })
    return svar(500, {
      fel: 'Rapporten är mejlad, men passet kunde inte markeras som skickat. Skicka INTE om — kunden har fått den.',
      utskicksId: id
    })
  }

  return svar(200, { skickat: true, mottagare, utskicksId: id })
})
