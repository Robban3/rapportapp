// Hämtar schemat ur Planday och lägger in passen i Raptr.
//
// Kontoret gör ingenting nytt: passen läggs ut i Planday som förut, personalen
// söker dem som förut, och Raptr följer efter. Det som försvinner är
// Google-dokumenten som skickas ut för hand varje dag.
//
// Två lägen, samma väg in:
//   { }                 hela horisonten, alla kopplade objekt (nattligt jobb)
//   { objektId, dagar } ett objekt och närtid (från passloggen när en värd
//                       öppnar appen och inte hittar sitt pass)
//
// Skrivningen görs av synka_planday, som är revoked från authenticated och
// därför anropas med service role. Alla regler om vad som får röras — låsta
// pass, handpålagd bemanning, den som skrivit i loggen — sitter där, inte här.
//
// Secrets sätts under Project Settings → Edge Functions → Secrets:
//   PLANDAY_CLIENT_ID, PLANDAY_REFRESH_TOKEN
//   PLANDAY_DAGAR (valfri, standard 30)

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { loggaIn, hamtaAlla, epostUr, namnUr, PlandayFel, type Klient } from './planday.ts'
import { gruppera, type Skift, type Anstalld } from './normalisera.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const svar = (status: number, kropp: unknown) =>
  new Response(JSON.stringify(kropp), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Högst en synk per objekt och minut. Utan strypningen blir passloggens
 *  60-sekunderspollning ett Planday-anrop per öppen telefon. */
const STRYPNING_SEKUNDER = 60

const iso = (d: Date) => d.toISOString().slice(0, 10)

type Objektrad = { id: string; namn: string; planday_department_id: number }
type Position = { id: number; name?: string | null }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return svar(405, { fel: 'Endast POST.' })

  const url = Deno.env.get('SUPABASE_URL')
  const anonNyckel = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceNyckel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const clientId = Deno.env.get('PLANDAY_CLIENT_ID')
  const refreshToken = Deno.env.get('PLANDAY_REFRESH_TOKEN')

  if (!url || !anonNyckel || !serviceNyckel) {
    return svar(500, { fel: 'Funktionen saknar konfiguration.' })
  }
  if (!clientId || !refreshToken) {
    return svar(500, {
      fel: 'PLANDAY_CLIENT_ID och PLANDAY_REFRESH_TOKEN är inte satta. Sätt dem under Edge Function Secrets.'
    })
  }

  const auth = req.headers.get('Authorization')
  if (!auth) return svar(401, { fel: 'Du måste vara inloggad.' })

  const kropp = await req.json().catch(() => ({}))
  const objektId = typeof kropp.objektId === 'string' ? kropp.objektId : null
  const dagar = Number(kropp.dagar ?? Deno.env.get('PLANDAY_DAGAR') ?? 30)
  if (!Number.isFinite(dagar) || dagar < 1 || dagar > 90) {
    return svar(400, { fel: 'Antal dagar måste vara mellan 1 och 90.' })
  }

  // Det nattliga jobbet anropar med service role och har ingen inloggad
  // användare. Allt annat är en människa och måste visa vad hen får göra.
  const bearer = auth.replace(/^Bearer\s+/i, '')
  const arSystem = bearer === serviceNyckel

  const somSystem = createClient(url, serviceNyckel)
  const somAnroparen = createClient(url, anonNyckel, {
    global: { headers: { Authorization: auth } }
  })

  // Felet ska överleva att fliken stängs — administratören ska kunna se varför
  // synken inte gått, inte bara gissa. Closure i stället för fristående
  // funktion: klientens typ går inte att skriva ut utan att tappa den.
  const noteraFel = async (rader: Objektrad[], text: string): Promise<void> => {
    for (const o of rader) {
      await somSystem.from('planday_synk').upsert({
        objekt_id: o.id, synkad_at: new Date().toISOString(), fel: text.slice(0, 500)
      }, { onConflict: 'objekt_id' })
    }
  }

  if (!arSystem) {
    if (!objektId) {
      // Hela horisonten är en driftåtgärd. En värd får bara be om sitt eget objekt.
      const { data: admin, error } = await somAnroparen.rpc('ar_admin')
      if (error) return svar(500, { fel: 'Kunde inte kontrollera behörigheten.', detalj: error.message })
      if (!admin) return svar(403, { fel: 'Bara administratörer får synka alla objekt.' })
    } else {
      // RLS på personal_objekt visar bara den inloggades egna kopplingar, så en
      // träff betyder att hen får fråga om objektet.
      const { data, error } = await somAnroparen
        .from('personal_objekt').select('objekt_id').eq('objekt_id', objektId).limit(1)
      if (error) return svar(500, { fel: 'Kunde inte kontrollera behörigheten.', detalj: error.message })
      if (!data || data.length === 0) return svar(403, { fel: 'Du är inte kopplad till objektet.' })
    }
  }

  // ---------- Vilka objekt ----------
  let fraga = somSystem.from('objekt')
    .select('id, namn, planday_department_id')
    .not('planday_department_id', 'is', null)
    .eq('aktiv', true)
  if (objektId) fraga = fraga.eq('id', objektId)

  const { data: objekten, error: objektFel } = await fraga
  if (objektFel) return svar(500, { fel: 'Kunde inte läsa objekten.', detalj: objektFel.message })

  const objekt = (objekten ?? []) as Objektrad[]
  if (objekt.length === 0) {
    return svar(200, { synkade: 0, anmarkning: 'Inget aktivt objekt är kopplat till Planday.' })
  }

  // ---------- Strypning ----------
  if (!arSystem && objektId) {
    const { data: senast } = await somSystem
      .from('planday_synk').select('synkad_at').eq('objekt_id', objektId).maybeSingle()
    if (senast?.synkad_at) {
      const alder = (Date.now() - new Date(senast.synkad_at).getTime()) / 1000
      if (alder < STRYPNING_SEKUNDER) {
        return svar(200, { synkade: 0, anmarkning: 'Nyligen synkad.', alder: Math.round(alder) })
      }
    }
  }

  // ---------- Hämta ur Planday ----------
  const idag = new Date()
  const till = new Date(idag.getTime() + (dagar - 1) * 86400000)
  const departments = objekt.map((o) => o.planday_department_id)

  let klient: Klient
  try {
    klient = await loggaIn(clientId, refreshToken)
  } catch (fel) {
    const text = fel instanceof PlandayFel ? fel.message : String(fel)
    console.error('planday-synk: inloggningen mot Planday misslyckades', { text })
    await noteraFel(objekt, text)
    return svar(502, { fel: text })
  }

  const sokning = new URLSearchParams({ from: iso(idag), to: iso(till) })
  for (const d of departments) sokning.append('departmentId', String(d))

  let skift: Skift[]
  let positioner = new Map<number, string>()
  let anstallda = new Map<number, Anstalld>()
  try {
    skift = await hamtaAlla<Skift>(klient, '/scheduling/v1.0/shifts', sokning, 5000)

    const pos = await hamtaAlla<Position>(klient, '/scheduling/v1.0/positions', new URLSearchParams(), 50)
    positioner = new Map(pos.filter((p) => p.name).map((p) => [p.id, String(p.name)]))

    const folk = await hamtaAlla<Record<string, unknown>>(
      klient, '/hr/v1.0/employees', new URLSearchParams(), 50)
    anstallda = new Map(folk
      .filter((a) => typeof a.id === 'number')
      .map((a) => [a.id as number, { epost: epostUr(a), namn: namnUr(a) }]))
  } catch (fel) {
    const text = fel instanceof PlandayFel ? `${fel.message} ${fel.detalj}` : String(fel)
    console.error('planday-synk: hämtningen misslyckades', { text })
    await noteraFel(objekt, text)
    return svar(502, { fel: 'Kunde inte hämta schemat från Planday.', detalj: text.slice(0, 300) })
  }

  // ---------- Skriv ----------
  const perDepartment = gruppera(skift, { positioner, anstallda })
  const resultat: Array<{ objekt: string; pass: number; bemanning: number; omatchade: number }> = []

  for (const o of objekt) {
    const rader = perDepartment.get(o.planday_department_id) ?? []
    const { data, error } = await somSystem.rpc('synka_planday', {
      p_objekt_id: o.id,
      p_pass: rader
    })

    if (error) {
      console.error('planday-synk: skrivningen misslyckades', { objekt: o.namn, fel: error.message })
      await noteraFel([o], error.message)
      continue
    }

    const rad = Array.isArray(data) ? data[0] : data
    resultat.push({
      objekt: o.namn,
      pass: rad?.pass_rorda ?? 0,
      bemanning: rad?.bemanning_rorda ?? 0,
      omatchade: rad?.omatchade ?? 0
    })
  }

  return svar(200, { synkade: resultat.length, fran: iso(idag), till: iso(till), resultat })
})

