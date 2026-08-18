// In-memory-datalager som används när Supabase-creds saknas, så appen går att
// köra direkt. Samma form som api.js exponerar mot Supabase. Datan lever i
// minnet under sessionen (nollställs vid omladdning).

import { sortKey, localISO, nowHHMM } from './time.js'

let seq = 100
const id = () => String(++seq)

const objekt = [
  { id: 'o1', namn: 'Clarion Draken Hotel', kod: 'DRAKEN', kund_epost: 'drift@clariondraken.se', aktiv: true },
  { id: 'o2', namn: 'Grand Central',        kod: 'GRAND',  kund_epost: 'reception@grandcentral.se', aktiv: true },
  { id: 'o3', namn: 'Scandic Väst',         kod: 'SCVAST', kund_epost: 'drift@scandicvast.se', aktiv: true }
]

// Ingen PIN-kolumn längre: lösenordet bor i Supabase Auth, och en läsbar
// lösenordskolumn var precis det RLS-migrationen gjorde sig av med.
const personal = [
  { id: 'p1', namn: 'Zäem', initialer: 'ZÄEM', roll: 'Värd',         epost: 'zaem@example.se',  aktiv: true },
  { id: 'p2', namn: 'Varo', initialer: 'VARO', roll: 'Värd',         epost: 'varo@example.se',  aktiv: true },
  { id: 'p3', namn: 'Pesa', initialer: 'PESA', roll: 'Ordningsvakt', epost: 'pesa@example.se',  aktiv: true },
  { id: 'p4', namn: 'Mobo', initialer: 'MOBO', roll: 'Ordningsvakt', epost: 'mobo@example.se',  aktiv: true },
  { id: 'p5', namn: 'Admin', initialer: 'ADM', roll: 'Admin',        epost: 'admin@example.se', aktiv: true }
]

// personal <-> objekt (styr vad appen visar). Admin (p5) är kopplad till alla.
let personalObjekt = [
  ['p1', 'o1'], ['p2', 'o1'], ['p3', 'o1'], ['p4', 'o1'],
  ['p2', 'o3'],
  ['p5', 'o1'], ['p5', 'o2'], ['p5', 'o3']
]

// Åtkomsten till passloggen avgörs av passets EGNA tider, så demopasset måste
// omsluta nuet oavsett när någon råkar öppna appen: det börjar två timmar bakåt
// och håller på i tolv. Öppnar du demon på kvällen sträcker det sig därmed över
// midnatt, precis som ett riktigt pass. Passet är daterat sin STARTDAG.
const demoStart = new Date(Date.now() - 2 * 60 * 60 * 1000)
demoStart.setMinutes(demoStart.getMinutes() < 30 ? 0 : 30, 0, 0)
const demoSlut = new Date(demoStart.getTime() + 12 * 60 * 60 * 1000)

// pass1 är daterat i historien och finns kvar för att adminpanelens rapportvy
// ska ha en färdig, sammanställd rapport att visa.
const pass = [
  { id: 'pass1', objekt_id: 'o1', datum: '2026-08-07', starttid: '14:30', sluttid: '03:00', status: 'granskas' },
  {
    id: 'pass2', objekt_id: 'o1', datum: localISO(demoStart),
    starttid: nowHHMM(demoStart), sluttid: nowHHMM(demoSlut), status: 'oppet'
  }
]

// Bemanningen styr vem som kommer åt passloggen. ZÄEM och MOBO är bemannade
// på dagens pass; VARO och PESA är kopplade till objektet men inte bemannade,
// så demoläget visar båda utfallen.
const passPersonal = [
  { pass_id: 'pass1', personal_id: 'p1', roll: 'Värd',         tid_in: '14:30', tid_ut: '23:30' },
  { pass_id: 'pass1', personal_id: 'p2', roll: 'Värd',         tid_in: '18:00', tid_ut: '01:30' },
  { pass_id: 'pass1', personal_id: 'p3', roll: 'Ordningsvakt', tid_in: '16:00', tid_ut: '01:30' },
  { pass_id: 'pass1', personal_id: 'p4', roll: 'Ordningsvakt', tid_in: '20:00', tid_ut: '03:00' },
  { pass_id: 'pass2', personal_id: 'p1', roll: 'Värd',         tid_in: '14:30', tid_ut: '23:30' },
  { pass_id: 'pass2', personal_id: 'p4', roll: 'Ordningsvakt', tid_in: '20:00', tid_ut: '03:00' }
]

const seedEntries = [
  ['14:30', 'p1', 'Start, lämnar radio hos Obie, Livingroom och rooftop.', null],
  ['15:00', 'p1', 'Kontrollerar våning tre, drama hall öppet pga möte. Öppnar upp våning 33. Toaletter nedre plan utan anmärkning.', null],
  ['15:45', 'p1', '20 gäster på rooftop, god stämning och låg berusning. Väcker en dam som sover i lobbyn.', null],
  ['18:00', 'p2', 'Påbörjar passet, hälsar på personalen och åker upp till rooftop.', null],
  ['18:45', 'p1', 'Alkoholeskort rum 1407 från rooftop. Rooftop 50 gäster. Dramahall låst.', 'info_alkohol'],
  ['20:00', 'p4', 'Påbörjar passet, hälsar på personalen.', null],
  ['20:20', 'p3', 'Rundar rooftop, ca 47 gäster. Bra stämning, ordning och reda, låg berusning.', null],
  ['21:20', 'p2', 'Alkoholeskort till våning 24.', 'info_alkohol'],
  ['22:00', 'p4', '110 gäster. Ordningsläge gott, berusning låg–medel.', null],
  ['23:15', 'p1', 'Upprörd gäst om stängda barer, hänvisas till rooftop. Nekar två minderåriga vid entré.', 'nekad_alder'],
  ['01:00', 'p3', 'Rooftop stänger, 22 gäster kvar.', null],
  ['02:30', 'p4', 'Yttre rond utförd utan anmärkning.', null],
  ['03:00', 'p4', 'Hänger av bricka, ställer radio i laddare. Avslutar passet.', null]
]

// Sorteringen utgår från passets start (14:30), annars hamnar inläggen efter
// midnatt (01:00, 02:30, 03:00) först i loggen i stället för sist.
let inlagg = seedEntries.map(([tid, pid, msg, inc]) => ({
  id: id(), pass_id: 'pass1', personal_id: pid, tid,
  sortnyckel: sortKey(tid, pass[0].starttid), meddelande: msg, incident_typ: inc,
  last: true, skapad_at: new Date().toISOString()
}))

export const db = {
  objekt, personal, pass, passPersonal, inlagg,
  get personalObjekt() { return personalObjekt },
  set personalObjekt(v) { personalObjekt = v },
  newId: id
}
