// Hämtar schemat ur Planday och lägger in passen i Raptr.
//
// Kontoret gör ingenting nytt: passen läggs ut i Planday som förut, personalen
// söker dem som förut, och Raptr följer efter. Det som försvinner är
// Google-dokumenten som skickas ut för hand varje dag.
//
// Tre lägen, samma väg in:
//   { }                 hela horisonten, alla kopplade objekt (admin)
//   { objektId, dagar } ett objekt och närtid (passloggen, när en värd öppnar
//                       appen och inte hittar sitt pass)
//   { mig: true }       den inloggades egna pass, oavsett koppling
//
// Det tredje läget finns för att det annars uppstår ett moment 22: en värd
// som aldrig synkats har ingen rad i personal_objekt, ser därför en tom
// objektlista, och har alltså inget objekt att öppna som kunde utlösa synken.
// Utan ett nattligt jobb fanns det då ingen som startade den första.
//
// Det söker först bara värdens EGNA skift för att få veta vilka objekt det
// gäller — och hämtar sedan ALLA skift för de objekten. En nyttolast med bara
// en persons skift hade fått synka_planday att radera de andras bemanning.
//
// Skrivningen görs av synka_planday, som är revoked från authenticated och
// därför anropas med service role. Alla regler om vad som får röras — låsta
// pass, handpålagd bemanning, den som skrivit i loggen — sitter där, inte här.
//
// Secrets sätts under Project Settings → Edge Functions → Secrets:
//   PLANDAY_CLIENT_ID, PLANDAY_REFRESH_TOKEN
//   PLANDAY_DAGAR (valfri, standard 30)
//
// Båda hämtas i Planday under Settings → Integrations → API Access: client_id
// står i kolumnen "App Id", refresh-token i "Token" när appen auktoriserats.

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { loggaIn, hamtaAlla, hamtaAnstallda, epostUr, namnUr, PlandayFel, type Klient } from './planday.ts'
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
  const minaPass = kropp.mig === true
  const dagar = Number(kropp.dagar ?? (minaPass ? 2 : Deno.env.get('PLANDAY_DAGAR') ?? 30))
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

  if (!arSystem && !minaPass) {
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

  // ---------- Logga in mot Planday ----------
  // Före objektvalet: mig-läget behöver Planday redan för att veta vilka
  // objekt det gäller.
  const idag = new Date()
  const till = new Date(idag.getTime() + (dagar - 1) * 86400000)

  let klient: Klient
  try {
    klient = await loggaIn(clientId, refreshToken)
  } catch (fel) {
    const text = fel instanceof PlandayFel ? fel.message : String(fel)
    console.error('planday-synk: inloggningen mot Planday misslyckades', { text })
    const { data: alla } = await somSystem.from('objekt')
      .select('id, namn, planday_department_id').not('planday_department_id', 'is', null)
    await noteraFel((alla ?? []) as Objektrad[], text)
    return svar(502, { fel: text })
  }

  // ---------- Vilka objekt ----------
  let fraga = somSystem.from('objekt')
    .select('id, namn, planday_department_id')
    .not('planday_department_id', 'is', null)
    .eq('aktiv', true)

  if (objektId) {
    fraga = fraga.eq('id', objektId)
  } else if (minaPass) {
    const { data: konto } = await somAnroparen.auth.getUser()
    const authId = konto?.user?.id
    if (!authId) return svar(401, { fel: 'Du måste vara inloggad.' })

    const { data: jag } = await somSystem.from('personal')
      .select('planday_employee_id, epost').eq('auth_user_id', authId).maybeSingle()
    if (!jag) return svar(403, { fel: 'Kontot är inte kopplat till någon personal.' })

    let empId: number | null = jag.planday_employee_id ?? null

    try {
      // Första gången är planday_employee_id inte inlärt än. Slå upp personen
      // på e-posten — det är samma nyckel som synken matchar på.
      if (empId === null && jag.epost) {
        const folk = await hamtaAnstallda(klient)
        const traff = folk.find(
          (a) => (epostUr(a) ?? '').toLowerCase() === String(jag.epost).toLowerCase())
        if (traff && typeof traff.id === 'number') empId = traff.id
      }

      if (empId === null) {
        return svar(200, { synkade: 0, anmarkning: 'Hittade dig inte i Planday.' })
      }

      // Bara de egna skiften, och bara för att få veta VILKA objekt det gäller.
      // Nyttolasten till synka_planday byggs sedan av samtliga skift för de
      // objekten — annars hade de andras bemanning raderats.
      const minSokning = new URLSearchParams({ from: iso(idag), to: iso(till) })
      minSokning.append('employeeId', String(empId))
      const minaSkift = await hamtaAlla<Skift>(klient, '/scheduling/v1.0/shifts', minSokning, 1000)

      const mina = [...new Set(minaSkift
        .filter((sk) => sk.status !== 'Draft' && sk.departmentId != null)
        .map((sk) => sk.departmentId))]

      if (mina.length === 0) {
        return svar(200, { synkade: 0, anmarkning: 'Du har inga pass i Planday de närmaste dagarna.' })
      }
      fraga = fraga.in('planday_department_id', mina)
    } catch (fel) {
      const text = fel instanceof PlandayFel ? `${fel.message} ${fel.detalj}` : String(fel)
      console.error('planday-synk: kunde inte slå upp egna pass', { text })
      return svar(502, { fel: 'Kunde inte hämta dina pass från Planday.', detalj: text.slice(0, 300) })
    }
  }

  const { data: objekten, error: objektFel } = await fraga
  if (objektFel) return svar(500, { fel: 'Kunde inte läsa objekten.', detalj: objektFel.message })

  const objekt = (objekten ?? []) as Objektrad[]
  if (objekt.length === 0) {
    return svar(200, { synkade: 0, anmarkning: 'Inget aktivt objekt är kopplat till Planday.' })
  }

  // ---------- Strypning ----------
  // Passloggen pollar var 60:e sekund. Utan strypningen blir det ett
  // Planday-anrop per öppen telefon.
  if (!arSystem) {
    const { data: senaste } = await somSystem
      .from('planday_synk').select('objekt_id, synkad_at')
      .in('objekt_id', objekt.map((o) => o.id))

    const farskt = new Set((senaste ?? [])
      .filter((r) => (Date.now() - new Date(r.synkad_at).getTime()) / 1000 < STRYPNING_SEKUNDER)
      .map((r) => r.objekt_id))

    if (farskt.size === objekt.length) {
      return svar(200, { synkade: 0, anmarkning: 'Nyligen synkad.' })
    }
  }

  const departments = objekt.map((o) => o.planday_department_id)
  const sokning = new URLSearchParams({ from: iso(idag), to: iso(till) })
  for (const d of departments) sokning.append('departmentId', String(d))

  let skift: Skift[]
  let positioner = new Map<number, string>()
  let anstallda = new Map<number, Anstalld>()
  try {
    skift = await hamtaAlla<Skift>(klient, '/scheduling/v1.0/shifts', sokning, 5000)

    const pos = await hamtaAlla<Position>(klient, '/scheduling/v1.0/positions', new URLSearchParams(), 50)
    positioner = new Map(pos.filter((p) => p.name).map((p) => [p.id, String(p.name)]))

    const folk = await hamtaAnstallda(klient)
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

