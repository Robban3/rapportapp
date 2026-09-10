// Översätter Plandays skift till Raptrs pass.
//
// Nyckelskillnaden mellan systemen: ETT PLANDAY-SKIFT ÄR EN PERSON, ett
// Raptr-pass är ett dygn på ett objekt. Femton personer på ett evenemang är
// femton skift i samma department samma dag, och blir ett pass med femton rader
// bemanning.
//
// Allt som kan bli fel — dygnsindelning, tidszoner, vilka skift som räknas —
// ligger här som rena funktioner, och testas från apptesterna i
// rapportapp/src/lib/planday.test.js. Edge Functions bundlar bara sin egen
// mapp, så modulen bor här men körs av testerna därifrån. Samma grepp som
// rapport-html.ts och rapport-pdf.ts.
//
// Att passet dateras sin startdag behöver INTE räknas ut: Plandays `date` är
// redan definierad som "what date in schedule the shift belongs to (a shift can
// cross midnight and the date property will always relate to the startDate)".
// Det är ordagrant Raptrs egen regel, så fältet används rakt av.

export const STANDARDZON = 'Europe/Stockholm'

/** Speglar ROLES i rapportapp/src/pages/admin/Staff.jsx. Admin ingår inte —
 *  det är en behörighet i Raptr, inte en position på ett pass. */
export const ROLLER = ['Värd', 'Ordningsvakt', 'Garderob']

/** Ett skift ur GET /scheduling/v1.0/shifts. Bara fälten Raptr bryr sig om. */
export type Skift = {
  id: number
  departmentId: number
  employeeId?: number | null
  positionId?: number | null
  date?: string | null
  timeZone?: string | null
  startDateTime?: string | null
  endDateTime?: string | null
  status?: string | null
}

export type Anstalld = { epost?: string | null; namn?: string | null }

export type Bemanningsrad = {
  planday_shift_id: number
  planday_employee_id: number
  epost: string | null
  namn: string | null
  roll: string | null
  tid_in: string | null
  tid_ut: string | null
}

export type Passrad = {
  datum: string
  starttid: string | null
  sluttid: string | null
  bemanning: Bemanningsrad[]
}

/**
 * Klockslaget i skiftets egen tidszon.
 *
 * Planday returnerar absoluta tidpunkter (`startDateTime` med Z) plus en
 * `timeZone` på skiftet. Raptr lagrar `time`, alltså väggklocka. Utan
 * konverteringen blir ett pass 22:00–06:00 svensk tid till 20:00–04:00 i
 * databasen, och passfönstret som släpper in värden hamnar två timmar fel.
 */
export function tidIZon(iso: string | null | undefined, zon?: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null

  const formatera = (tz: string) =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(t)

  try {
    return formatera(zon || STANDARDZON)
  } catch {
    // En tidszon Deno inte känner igen ska inte fälla hela synken. Svensk tid
    // är rätt för varenda objekt vi har; loggen visar avvikelsen.
    console.warn('planday-synk: okänd tidszon, faller tillbaka på ' + STANDARDZON, { zon })
    return formatera(STANDARDZON)
  }
}

/**
 * Plandays position till en Raptr-roll.
 *
 * Bara namn som motsvarar en av Raptrs roller släpps igenom. Ett fritt
 * positionsnamn ur Planday ("Reception kväll", "Extra 3") ska inte hamna rakt i
 * rapporten kunden får — då står hellre rollen tom, och SQL:en behåller den
 * bemanning som redan finns.
 */
export function rollFor(positionsnamn: string | null | undefined): string | null {
  const rat = String(positionsnamn ?? '').trim()
  if (!rat) return null
  return ROLLER.find((r) => r.toLowerCase() === rat.toLowerCase()) || null
}

/** Ett utkast är inte publicerat för personalen och får aldrig nå Raptr. */
export function arPublicerat(skift: Skift): boolean {
  return skift.status !== 'Draft'
}

type Bygge = {
  datum: string
  startVid: number | null
  slutVid: number | null
  startIso: string | null
  slutIso: string | null
  zon: string | null
  bemanning: Bemanningsrad[]
}

/**
 * Grupperar skift till pass, per department.
 *
 * Passets tider blir tidigaste start och senaste slut bland dygnets skift —
 * en ordningsvakt som börjar 20:00 när värden börjat 14:30 ska inte flytta
 * passets start.
 *
 * Ett skift utan `employeeId` (status Open) ger inget bemanningsrad men räknas
 * ändå in i tiderna: passet ska finnas i Raptr med rätt tider så fort det
 * publicerats, och bemanningen fylls i när någon söker det.
 */
export function gruppera(
  skift: Skift[],
  opt: {
    positioner?: Map<number, string>
    anstallda?: Map<number, Anstalld>
  } = {}
): Map<number, Passrad[]> {
  const positioner = opt.positioner || new Map<number, string>()
  const anstallda = opt.anstallda || new Map<number, Anstalld>()
  const grupper = new Map<string, Bygge>()

  for (const s of skift) {
    if (!arPublicerat(s)) continue
    if (s.departmentId == null || !s.date) continue

    const nyckel = `${s.departmentId}|${s.date}`
    let g = grupper.get(nyckel)
    if (!g) {
      g = {
        datum: s.date, startVid: null, slutVid: null,
        startIso: null, slutIso: null, zon: s.timeZone || null, bemanning: []
      }
      grupper.set(nyckel, g)
    }
    if (!g.zon && s.timeZone) g.zon = s.timeZone

    const start = s.startDateTime ? new Date(s.startDateTime).getTime() : NaN
    if (!Number.isNaN(start) && (g.startVid === null || start < g.startVid)) {
      g.startVid = start
      g.startIso = s.startDateTime || null
    }

    const slut = s.endDateTime ? new Date(s.endDateTime).getTime() : NaN
    if (!Number.isNaN(slut) && (g.slutVid === null || slut > g.slutVid)) {
      g.slutVid = slut
      g.slutIso = s.endDateTime || null
    }

    if (s.employeeId == null) continue

    const person = anstallda.get(s.employeeId) || {}
    g.bemanning.push({
      planday_shift_id: s.id,
      planday_employee_id: s.employeeId,
      epost: person.epost || null,
      namn: person.namn || null,
      roll: rollFor(s.positionId == null ? null : positioner.get(s.positionId)),
      tid_in: tidIZon(s.startDateTime, s.timeZone),
      tid_ut: tidIZon(s.endDateTime, s.timeZone)
    })
  }

  const ut = new Map<number, Passrad[]>()
  for (const [nyckel, g] of grupper) {
    const department = Number(nyckel.split('|')[0])
    const rader = ut.get(department) || []
    rader.push({
      datum: g.datum,
      starttid: tidIZon(g.startIso, g.zon),
      sluttid: tidIZon(g.slutIso, g.zon),
      bemanning: g.bemanning
    })
    ut.set(department, rader)
  }
  for (const rader of ut.values()) rader.sort((a, b) => a.datum.localeCompare(b.datum))
  return ut
}
