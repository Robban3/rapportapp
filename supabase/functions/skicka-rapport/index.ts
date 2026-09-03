// Låser passet och mejlar rapporten till objektets mottagare.
//
// Ordningen är medveten: passet låses FÖRST, rapporten renderas ur det låsta
// tillståndet, och sedan skickas mejlet. Tvärtom hade ett inlägg som skrivs i
// samma sekund kunnat hamna i loggen men utanför rapporten — tyst och
// permanent. Går utskicket fel är passet låst men omarkerat som skickat, och
// administratören ser att det behöver skickas om. Synligt fel slår tyst fel.
//
// RESEND_API_KEY sätts som secret:
//   supabase secrets set RESEND_API_KEY=re_...
// (SUPABASE_URL, SUPABASE_ANON_KEY och SUPABASE_SERVICE_ROLE_KEY injiceras
// automatiskt av plattformen och kan inte sättas för hand.)

import { createClient } from 'npm:@supabase/supabase-js@2'
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
  const avsandare = Deno.env.get('RAPPORT_AVSANDARE') ?? 'onboarding@resend.dev'

  if (!url || !anonNyckel) return svar(500, { fel: 'Funktionen saknar konfiguration.' })
  if (!resendNyckel) {
    return svar(500, { fel: 'RESEND_API_KEY är inte satt. Kör: supabase secrets set RESEND_API_KEY=re_...' })
  }

  const auth = req.headers.get('Authorization')
  if (!auth) return svar(401, { fel: 'Du måste vara inloggad.' })

  // Klienten agerar som anroparen och lyder RLS hela vägen. Ingen
  // service_role-nyckel behövs: admin får redan läsa och låsa passet.
  const somAnroparen = createClient(url, anonNyckel, { global: { headers: { Authorization: auth } } })

  const { data: { user }, error: userFel } = await somAnroparen.auth.getUser()
  if (userFel || !user) return svar(401, { fel: 'Din session har gått ut. Logga in igen.' })

  const { data: mig } = await somAnroparen
    .from('personal').select('roll, aktiv').eq('auth_user_id', user.id).maybeSingle()
  if (!mig?.aktiv || mig.roll !== 'Admin') {
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
      .from('pass').update({ status: 'skickat', skickad_at: new Date().toISOString() }).eq('id', passId)
    if (lasFel) return svar(500, { fel: 'Kunde inte låsa passet. Inget skickades.' })
  }

  const { data: roster } = await somAnroparen
    .from('pass_personal').select('*, personal:personal_id ( initialer, namn )').eq('pass_id', passId)

  const { data: inlagg } = await somAnroparen
    .from('inlagg').select('*, personal:personal_id ( initialer )')
    .eq('pass_id', passId).order('sortnyckel').order('skapad_at')

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
    // Passet är låst men rapporten kom inte fram. Det ska synas, inte tystas:
    // administratören måste kunna skicka om.
    const detalj = await resp.text().catch(() => '')
    return svar(502, {
      fel: 'Passet är låst, men mejlet gick inte iväg. Välj Skicka om när felet är åtgärdat.',
      detalj: detalj.slice(0, 300)
    })
  }

  const { id } = await resp.json().catch(() => ({ id: null }))
  return svar(200, { skickat: true, mottagare, utskicksId: id })
})
