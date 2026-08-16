// Enat datalager. Kör mot Supabase om creds finns, annars mot mock-datan.
// Alla funktioner returnerar samma form oavsett backend, så UI:t inte behöver
// bry sig om vilket som är aktivt.
//
// Regel: varje Supabase-anrop går genom kastaVidFel/kravRad. Ett svalt fel
// blir annars en tom lista eller en TypeError långt senare, och en värd mitt
// i ett pass får ingen aning om att inlägget inte sparades.

import { hasSupabase, supabase } from './supabase.js'
import { db } from './mockStore.js'
import {
  sortKey, nowHHMM, normalizeTid, normalizeKlockslag, verksamhetsdatum,
  localISO, passFonster, arPassAktivt
} from './time.js'
import { emptyStats, INCIDENT_TYPES } from './incidents.js'
import { ApiError, kastaVidFel, kravRad } from './errors.js'

const clone = (x) => JSON.parse(JSON.stringify(x))
const personalMed = (pid) => db.personal.find((p) => p.id === pid)

// ------------------------------------------------------------------ auth
export async function signIn(kod) {
  if (!hasSupabase) {
    return clone(db.personal.find((p) => p.kod === String(kod).trim() && p.aktiv) || null)
  }
  const svar = await supabase.from('personal').select('*').eq('kod', String(kod).trim()).eq('aktiv', true).maybeSingle()
  return kastaVidFel(svar, 'logga in') || null
}

// -------------------------------------------------------- objekt för person
export async function objectsForStaff(personalId) {
  if (!hasSupabase) {
    const ids = db.personalObjekt.filter(([pid]) => pid === personalId).map(([, oid]) => oid)
    return clone(db.objekt.filter((o) => ids.includes(o.id) && o.aktiv))
  }
  const svar = await supabase
    .from('personal_objekt')
    .select('objekt:objekt_id ( id, namn, kod, kund_epost, aktiv )')
    .eq('personal_id', personalId)
  const data = kastaVidFel(svar, 'hämta dina objekt')
  return (data || []).map((r) => r.objekt).filter((o) => o && o.aktiv)
}

/** Har personen behörighet till objektet? Kontrolleras innan pass öppnas. */
export async function harBehorighet(personalId, objektId) {
  const objekt = await objectsForStaff(personalId)
  return objekt.some((o) => o.id === objektId)
}

// -------------------------------------------------- öppet pass för ett objekt
/**
 * Hämtar passet för objekt+datum och skapar det om det saknas.
 *
 * OBS: bara adminpanelen får anropa den här. Personal går via `passForStaff`,
 * som aldrig skapar något — annars skulle vem som helst med objektbehörighet
 * kunna lägga upp ett pass hen inte är bemannad på och börja skriva i det.
 */
export async function openPassForObjekt(objektId, datum = verksamhetsdatum(), starttid = nowHHMM()) {
  // Starttiden är inte kosmetisk: sortKey() räknar inläggens ordning från
  // den, så ett nattpass som fått fel starttid lägger inläggen efter midnatt
  // först i rapporten. Lägger admin upp passet i förväg måste tiden därför
  // gå att ange i stället för att stämplas med "nu".
  //
  // Otolkbar tid kastar i stället för att tyst bli klockan nu — setPassTider
  // kastade redan för samma indata, och två olika svar på samma fel är värre
  // än båda felen var för sig.
  const start = normalizeKlockslag(starttid)
  if (!start) {
    throw new ApiError('Starttiden går inte att tolka. Skriv den som HH:MM, t.ex. 14:30.', { kod: 'ogiltig_tid' })
  }

  if (!hasSupabase) {
    let p = db.pass.find((x) => x.objekt_id === objektId && x.datum === datum)
    if (!p) {
      p = { id: db.newId(), objekt_id: objektId, datum, starttid: start, sluttid: null, status: 'oppet' }
      db.pass.push(p)
    }
    return clone(p)
  }

  const befintligt = kastaVidFel(
    await supabase.from('pass').select('*').eq('objekt_id', objektId).eq('datum', datum).maybeSingle(),
    'hämta passet'
  )
  if (befintligt) return befintligt

  // Två administratörer som lägger upp samma pass samtidigt är fullt möjligt.
  // Krocken mot unique (objekt_id, datum) ska inte lämna den ena med ett
  // odefinierat pass och en permanent trasig sida — läs om i stället.
  const skapat = await supabase.from('pass')
    .insert({ objekt_id: objektId, datum, starttid: start, status: 'oppet' })
    .select().maybeSingle()

  if (skapat.error) {
    if (skapat.error.code === '23505') {
      return kravRad(
        await supabase.from('pass').select('*').eq('objekt_id', objektId).eq('datum', datum).maybeSingle(),
        'hämta passet någon annan just öppnade'
      )
    }
    throw new ApiError('Kunde inte öppna passet.', { orsak: skapat.error, kod: skapat.error.code })
  }
  return kravRad(skapat, 'öppna passet')
}

/**
 * Passets start- och sluttid. Sluttiden sätts oftast först när passet är slut.
 *
 * Inläggens `sortnyckel` räknas ut mot starttiden när de skrivs, så en ändrad
 * starttid måste räkna om dem. Utan omräkningen skulle en rättad starttid ge
 * en rapport där inläggen ligger i fel ordning utan att något syns fel.
 *
 * Ett fält som INTE skickas med lämnas orört. Tidigare nollades det i stället,
 * så ett anrop med bara sluttid tog bort starttiden — och därmed ankaret som
 * håller inläggen efter midnatt sist i rapporten. Skicka tom sträng för att
 * medvetet rensa sluttiden.
 */
export async function setPassTider(passId, tider = {}) {
  const nuvarande = await passById(passId)
  if (!nuvarande) throw new ApiError('Passet finns inte.', { kod: 'saknas' })

  const start = losTid(tider, 'starttid', nuvarande.starttid, 'Starttiden')
  const slut = losTid(tider, 'sluttid', nuvarande.sluttid, 'Sluttiden')
  if (!start) throw new ApiError('Passet måste ha en starttid. Skriv den som HH:MM, t.ex. 14:30.', { kod: 'ogiltig_tid' })

  if (!hasSupabase) {
    const p = db.pass.find((x) => x.id === passId)
    p.starttid = start
    p.sluttid = slut
    for (const i of db.inlagg) {
      if (i.pass_id === passId) i.sortnyckel = sortKey(i.tid, start)
    }
    return clone(p)
  }

  const uppdaterat = kravRad(
    await supabase.from('pass').update({ starttid: start, sluttid: slut }).eq('id', passId).select().maybeSingle(),
    'spara passets tider'
  )

  const rader = kastaVidFel(
    await supabase.from('inlagg').select('id, tid').eq('pass_id', passId),
    'hämta inläggen för omsortering'
  )
  for (const rad of rader || []) {
    kastaVidFel(
      await supabase.from('inlagg').update({ sortnyckel: sortKey(rad.tid, start) }).eq('id', rad.id),
      'sortera om inläggen'
    )
  }
  return uppdaterat
}

// ------------------------------------------------------------- bemanning
// `personal_objekt` säger vilka objekt en person FÅR bemannas på.
// `pass_personal` säger vilka som FAKTISKT jobbar ett visst pass, och det är
// den som avgör vem som kommer åt passloggen.

/** Ett pass på id. Skapar inget. */
export async function passById(passId) {
  if (!hasSupabase) return clone(db.pass.find((p) => p.id === passId) || null)
  const svar = await supabase.from('pass').select('*').eq('id', passId).maybeSingle()
  return kastaVidFel(svar, 'hämta passet') || null
}

/**
 * Läser ut ett tidsfält ur ett delvis ifyllt anrop.
 *
 * Utelämnat (`undefined`) betyder oförändrat, tom sträng eller null betyder
 * rensa, och allt annat måste gå att tolka som ett klockslag.
 */
function losTid(tider, falt, nuvarande, etikett) {
  if (!(falt in tider) || tider[falt] === undefined) return nuvarande || null
  if (tider[falt] === null || String(tider[falt]).trim() === '') return null

  const tolkad = normalizeKlockslag(tider[falt])
  if (!tolkad) throw new ApiError(`${etikett} går inte att tolka. Skriv den som HH:MM, t.ex. 14:30.`, { kod: 'ogiltig_tid' })
  return tolkad
}

/** Passet för objekt+datum, eller null. Skapar inget — det gör openPassForObjekt. */
export async function passForObjektDatum(objektId, datum) {
  if (!hasSupabase) {
    return clone(db.pass.find((x) => x.objekt_id === objektId && x.datum === datum) || null)
  }
  const svar = await supabase.from('pass').select('*').eq('objekt_id', objektId).eq('datum', datum).maybeSingle()
  return kastaVidFel(svar, 'hämta passet') || null
}

/**
 * Passet en person får skriva i för ett objekt ett visst datum.
 *
 * Returnerar alltid ett objekt så anroparen kan skilja på de tre utfallen:
 * inget pass upplagt (`pass: null`), upplagt men obemannad (`bemannad: false`)
 * och bemannad. Ett kastat fel skulle slå ihop dem till "något gick fel".
 */
export async function passForStaff(personalId, objektId, datum = verksamhetsdatum()) {
  const p = await passForObjektDatum(objektId, datum)
  if (!p) return { pass: null, bemannad: false }

  if (!hasSupabase) {
    return {
      pass: p,
      bemannad: db.passPersonal.some((r) => r.pass_id === p.id && r.personal_id === personalId)
    }
  }

  const rad = kastaVidFel(
    await supabase.from('pass_personal').select('personal_id')
      .eq('pass_id', p.id).eq('personal_id', personalId).maybeSingle(),
    'kontrollera bemanningen'
  )
  return { pass: p, bemannad: Boolean(rad) }
}

/**
 * Datumen ett pågående pass kan vara daterat. Ett pass bär sin STARTDAG, så
 * kl 02:00 jobbar man i gårdagens pass.
 *
 * I morgon är med för den tidiga toleransens skull: kl 23:45 ska ett pass som
 * börjar 00:30 redan gå att öppna, och det är daterat nästa dygn.
 */
function aktuellaDatum(nu = new Date()) {
  const igar = new Date(nu.getTime())
  igar.setDate(igar.getDate() - 1)
  const imorgon = new Date(nu.getTime())
  imorgon.setDate(imorgon.getDate() + 1)
  return [localISO(igar), localISO(nu), localISO(imorgon)]
}

/** Passen på ett objekt som kan vara igång nu, oavsett bemanning. */
async function passKandidater(objektId, nu) {
  const datumen = aktuellaDatum(nu)
  if (!hasSupabase) {
    return db.pass.filter((p) => p.objekt_id === objektId && datumen.includes(p.datum)).map((p) => clone(p))
  }
  const svar = await supabase.from('pass').select('*').eq('objekt_id', objektId).in('datum', datumen)
  return kastaVidFel(svar, 'hämta passen') || []
}

/**
 * Passet en person ska skriva i just nu på ett objekt.
 *
 * Väljer det pass vars egna tider omsluter nuet, i stället för att räkna ut
 * ett verksamhetsdatum. Skillnaden märks på nattpass: med en fast brytpunkt
 * kl 05 tappade en värd som jobbade 22:00–06:00 sitt pass en timme innan hen
 * slutade.
 *
 * Tre utfall hålls isär: inget pass igång (`pass: null`), pass igång men
 * obemannad (`bemannad: false`), och bemannad.
 */
export async function aktivtPassForStaff(personalId, objektId, nu = new Date()) {
  const kandidater = await passKandidater(objektId, nu)
  const igang = kandidater
    .filter((p) => arPassAktivt(p, nu))
    .sort((a, b) => passFonster(b).start - passFonster(a).start)

  if (!igang.length) return { pass: null, bemannad: false }

  const mina = await bemannadePassIds(personalId, igang.map((p) => p.id))

  // Är personen bemannad på något av dem vinner det. Annars returneras det
  // senast startade ändå, så UI:t kan säga "du är inte bemannad" i stället
  // för det missvisande "inget pass är upplagt".
  const valt = igang.find((p) => mina.has(p.id)) || igang[0]
  return { pass: valt, bemannad: mina.has(valt.id) }
}

async function bemannadePassIds(personalId, passIds) {
  if (!passIds.length) return new Set()
  if (!hasSupabase) {
    return new Set(
      db.passPersonal
        .filter((r) => r.personal_id === personalId && passIds.includes(r.pass_id))
        .map((r) => r.pass_id)
    )
  }
  const svar = await supabase.from('pass_personal').select('pass_id')
    .eq('personal_id', personalId).in('pass_id', passIds)
  return new Set((kastaVidFel(svar, 'kontrollera bemanningen') || []).map((r) => r.pass_id))
}

/**
 * Status per objekt för objektlistan: `bemannad`, `ej_bemannad` eller
 * `inget_pass`.
 *
 * De tre hålls isär för att kortet inte ska ljuga. Ett "Ej bemannad" mitt på
 * dagen, när kvällens pass ännu inte startat, hade fått en värd att tro att
 * hen strukits från schemat.
 */
export async function objektStatusForStaff(personalId, objektIds, nu = new Date()) {
  const status = Object.fromEntries(objektIds.map((id) => [id, 'inget_pass']))
  if (!objektIds.length) return status

  const datumen = aktuellaDatum(nu)

  let pass
  if (!hasSupabase) {
    pass = db.pass.filter((p) => objektIds.includes(p.objekt_id) && datumen.includes(p.datum)).map(clone)
  } else {
    const svar = await supabase.from('pass').select('*').in('objekt_id', objektIds).in('datum', datumen)
    pass = kastaVidFel(svar, 'hämta passen') || []
  }

  const igang = pass.filter((p) => arPassAktivt(p, nu))
  if (!igang.length) return status

  const mina = await bemannadePassIds(personalId, igang.map((p) => p.id))
  for (const p of igang) {
    // Ett bemannat pass slår ett obemannat om två skulle överlappa.
    if (mina.has(p.id)) status[p.objekt_id] = 'bemannad'
    else if (status[p.objekt_id] === 'inget_pass') status[p.objekt_id] = 'ej_bemannad'
  }
  return status
}

export async function rosterForPass(passId) {
  const sortera = (a, b) => String(a.initialer || '').localeCompare(String(b.initialer || ''), 'sv')

  if (!hasSupabase) {
    return db.passPersonal.filter((r) => r.pass_id === passId)
      .map((r) => ({ ...r, initialer: personalMed(r.personal_id)?.initialer, namn: personalMed(r.personal_id)?.namn }))
      .sort(sortera)
  }
  const svar = await supabase.from('pass_personal')
    .select('*, personal:personal_id ( initialer, namn )').eq('pass_id', passId)
  const data = kastaVidFel(svar, 'hämta bemanningen')
  return (data || []).map((r) => ({ ...r, initialer: r.personal?.initialer, namn: r.personal?.namn })).sort(sortera)
}

/** Lägger till personen på passet, eller uppdaterar roll och tider om hen redan står där. */
export async function setRosterEntry(passId, personalId, { roll = null, tid_in = null, tid_ut = null } = {}) {
  if (!passId || !personalId) throw new ApiError('Pass och person måste anges.', { kod: 'ofullstandig' })

  // Tomma tider är tillåtna — de fylls ofta i först när passet är slut.
  // Ett intervall vore däremot meningslöst här: man går på ett klockslag.
  const inTid = tid_in ? normalizeKlockslag(tid_in) : null
  const utTid = tid_ut ? normalizeKlockslag(tid_ut) : null
  if (tid_in && !inTid) throw new ApiError('Tiden in går inte att tolka. Skriv den som HH:MM.', { kod: 'ogiltig_tid' })
  if (tid_ut && !utTid) throw new ApiError('Tiden ut går inte att tolka. Skriv den som HH:MM.', { kod: 'ogiltig_tid' })

  const rad = { pass_id: passId, personal_id: personalId, roll, tid_in: inTid, tid_ut: utTid }

  if (!hasSupabase) {
    const i = db.passPersonal.findIndex((r) => r.pass_id === passId && r.personal_id === personalId)
    if (i >= 0) db.passPersonal[i] = rad
    else db.passPersonal.push(rad)
    return { ...rad, initialer: personalMed(personalId)?.initialer, namn: personalMed(personalId)?.namn }
  }

  const data = kravRad(
    await supabase.from('pass_personal').upsert(rad, { onConflict: 'pass_id,personal_id' })
      .select('*, personal:personal_id ( initialer, namn )').maybeSingle(),
    'spara bemanningen'
  )
  return { ...data, initialer: data.personal?.initialer, namn: data.personal?.namn }
}

export async function removeRosterEntry(passId, personalId) {
  if (!hasSupabase) {
    const i = db.passPersonal.findIndex((r) => r.pass_id === passId && r.personal_id === personalId)
    if (i >= 0) db.passPersonal.splice(i, 1)
    return { ok: true }
  }
  kastaVidFel(
    await supabase.from('pass_personal').delete().eq('pass_id', passId).eq('personal_id', personalId),
    'ta bort personen från passet'
  )
  return { ok: true }
}

/**
 * Senaste passet på objektet före `foreDatum` som faktiskt hade bemanning.
 * Driver "kopiera förra passets bemanning" — laget är sällan nytt varje dag.
 */
export async function senasteBemannadePass(objektId, foreDatum) {
  let kandidater
  if (!hasSupabase) {
    kandidater = db.pass
      .filter((p) => p.objekt_id === objektId && p.datum < foreDatum)
      .sort((a, b) => b.datum.localeCompare(a.datum))
      .map(clone)
  } else {
    const svar = await supabase.from('pass').select('*').eq('objekt_id', objektId)
      .lt('datum', foreDatum).order('datum', { ascending: false }).limit(10)
    kandidater = kastaVidFel(svar, 'hämta tidigare pass') || []
  }

  // Ett upplagt men obemannat pass är inget att kopiera från — leta vidare.
  for (const p of kandidater) {
    const roster = await rosterForPass(p.id)
    if (roster.length) return { pass: p, roster }
  }
  return null
}

/** Kopierar bemanningen från ett tidigare pass. Rör inte dem som redan står på passet. */
export async function kopieraBemanning(franPassId, tillPassId) {
  const kalla = await rosterForPass(franPassId)
  const redanPa = new Set((await rosterForPass(tillPassId)).map((r) => r.personal_id))

  let lagda = 0
  for (const r of kalla) {
    if (redanPa.has(r.personal_id)) continue
    await setRosterEntry(tillPassId, r.personal_id, { roll: r.roll, tid_in: r.tid_in, tid_ut: r.tid_ut })
    lagda++
  }
  return { lagda, hoppade: kalla.length - lagda }
}

/** Personal som får bemannas på objektet, dvs. de som är kopplade till det. */
export async function staffForObjekt(objektId) {
  const sortera = (a, b) => String(a.initialer || '').localeCompare(String(b.initialer || ''), 'sv')

  if (!hasSupabase) {
    const ids = db.personalObjekt.filter(([, oid]) => oid === objektId).map(([pid]) => pid)
    return clone(db.personal.filter((p) => ids.includes(p.id) && p.aktiv)).sort(sortera)
  }
  const svar = await supabase.from('personal_objekt')
    .select('personal:personal_id ( id, namn, initialer, roll, aktiv )').eq('objekt_id', objektId)
  const data = kastaVidFel(svar, 'hämta personalen på objektet')
  return (data || []).map((r) => r.personal).filter((p) => p && p.aktiv).sort(sortera)
}

// ------------------------------------------------------ inlägg i ett pass
export async function entriesForPass(passId) {
  if (!hasSupabase) {
    return db.inlagg.filter((i) => i.pass_id === passId)
      .map((i) => ({ ...i, signatur: personalMed(i.personal_id)?.initialer }))
      .sort((a, b) => a.sortnyckel - b.sortnyckel || a.skapad_at.localeCompare(b.skapad_at))
  }
  const svar = await supabase
    .from('inlagg')
    .select('*, personal:personal_id ( initialer, namn )')
    .eq('pass_id', passId)
    .order('sortnyckel').order('skapad_at')
  const data = kastaVidFel(svar, 'hämta passloggen')
  return (data || []).map((i) => ({ ...i, signatur: i.personal?.initialer }))
}

export async function addEntry({ passId, personalId, tid, meddelande, incidentTyp = null, passStartTid = null }) {
  const text = String(meddelande || '').trim()
  if (!text) throw new ApiError('Inlägget saknar text.', { kod: 'tom_text' })

  // Tom tid betyder "nu" — bekvämt för ett inlägg som skrivs i stunden. Men en
  // tid som ANGETTS och inte går att tolka ska kasta, inte tyst bli klockan nu:
  // inlägget hamnar då på fel plats i rapporten utan att någon märker det.
  // Samma regel som openPassForObjekt. Tidigare gjorde `?? normalizeTid(nowHHMM())`
  // kontrollen på raden under oåtkomlig, eftersom nu-tiden alltid går att tolka.
  const rat = String(tid ?? '').trim()
  const angivenTid = rat === '' ? nowHHMM() : normalizeTid(rat)
  if (!angivenTid) throw new ApiError('Tiden går inte att tolka. Skriv den som HH:MM, t.ex. 21:05.', { kod: 'ogiltig_tid' })

  // Spärren finns även i UI:t, men den är beroende av att pollningen hunnit
  // uppdatera passet. En låst rapport ska inte kunna växa på grund av en
  // kapplöpning — rättelser läggs till av admin.
  const passet = await passById(passId)
  if (!passet) throw new ApiError('Passet finns inte.', { kod: 'saknas' })
  if (passet.status === 'skickat') {
    throw new ApiError('Passet är låst och rapporten skickad. Be en administratör lägga till rättelsen.', { kod: 'last' })
  }

  const row = {
    pass_id: passId, personal_id: personalId, tid: angivenTid,
    sortnyckel: sortKey(angivenTid, passStartTid), meddelande: text,
    incident_typ: incidentTyp, last: true
  }

  if (!hasSupabase) {
    const saved = { ...row, id: db.newId(), skapad_at: new Date().toISOString() }
    db.inlagg.push(saved)
    return { ...saved, signatur: personalMed(personalId)?.initialer }
  }
  const data = kravRad(
    await supabase.from('inlagg').insert(row).select('*, personal:personal_id ( initialer )').maybeSingle(),
    'spara inlägget'
  )
  return { ...data, signatur: data.personal?.initialer }
}

// --------------------------------------------------------- admin: pass-lista
export async function passList(status) {
  // status: array av statusvärden, t.ex. ['oppet','granskas'] eller ['skickat']
  if (!hasSupabase) {
    return db.pass.filter((p) => status.includes(p.status))
      .map((p) => ({ ...p, objekt_namn: db.objekt.find((o) => o.id === p.objekt_id)?.namn }))
      .sort((a, b) => b.datum.localeCompare(a.datum))
  }
  const svar = await supabase.from('pass').select('*, objekt:objekt_id ( namn )').in('status', status).order('datum', { ascending: false })
  const data = kastaVidFel(svar, 'hämta passen')
  return (data || []).map((p) => ({ ...p, objekt_namn: p.objekt?.namn }))
}

// ------------------------------------------------- admin: sammanställd rapport
export async function report(passId) {
  const entries = await entriesForPass(passId)
  const stats = emptyStats()
  for (const e of entries) if (e.incident_typ && stats[e.incident_typ] != null) stats[e.incident_typ]++

  if (!hasSupabase) {
    const p = db.pass.find((x) => x.id === passId)
    if (!p) throw new ApiError('Passet finns inte.', { kod: 'saknas' })
    const objekt = db.objekt.find((o) => o.id === p.objekt_id)
    const roster = db.passPersonal.filter((r) => r.pass_id === passId).map((r) => ({
      ...r, initialer: personalMed(r.personal_id)?.initialer, namn: personalMed(r.personal_id)?.namn
    }))
    return { pass: clone(p), objekt: clone(objekt), roster, entries, stats }
  }

  const p = kravRad(
    await supabase.from('pass').select('*, objekt:objekt_id ( * )').eq('id', passId).maybeSingle(),
    'hämta rapporten'
  )
  const roster = kastaVidFel(
    await supabase.from('pass_personal').select('*, personal:personal_id ( initialer, namn )').eq('pass_id', passId),
    'hämta personalen på passet'
  )
  return {
    pass: p, objekt: p.objekt,
    roster: (roster || []).map((r) => ({ ...r, initialer: r.personal?.initialer, namn: r.personal?.namn })),
    entries, stats
  }
}

/**
 * Låser passet. OBS: genererar INGEN PDF och skickar INGET mejl — den
 * kedjan byggs i Fas 1.2 som en Edge Function. Returvärdet säger därför
 * `utskickat: false`, så UI:t inte kan påstå något annat för administratören.
 */
export async function lockAndSend(passId, epost) {
  if (!hasSupabase) {
    const p = db.pass.find((x) => x.id === passId)
    if (!p) throw new ApiError('Passet finns inte.', { kod: 'saknas' })
    p.status = 'skickat'
    p.skickad_at = new Date().toISOString()
    return { ok: true, epost, utskickat: false }
  }
  kastaVidFel(
    await supabase.from('pass').update({ status: 'skickat', skickad_at: new Date().toISOString() }).eq('id', passId),
    'låsa passet'
  )
  return { ok: true, epost, utskickat: false }
}

// ----------------------------------------------- admin: personal & behörighet
export async function listStaff() {
  if (!hasSupabase) return clone([...db.personal].sort((a, b) => a.initialer.localeCompare(b.initialer, 'sv')))
  const svar = await supabase.from('personal').select('*').order('initialer')
  return kastaVidFel(svar, 'hämta personalen') || []
}

export async function addStaff({ namn, initialer, roll, kod }) {
  const row = { namn: namn.trim(), initialer: initialer.trim(), roll, kod: kod.trim(), aktiv: true }
  if (!row.namn || !row.initialer || !row.kod) {
    throw new ApiError('Namn, initialer och kod måste fyllas i.', { kod: 'ofullstandig' })
  }

  if (!hasSupabase) {
    if (db.personal.some((p) => p.kod === row.kod)) {
      throw new ApiError('Koden används redan av någon annan.', { kod: 'dublett' })
    }
    const saved = { ...row, id: db.newId() }
    db.personal.push(saved)
    return clone(saved)
  }

  const svar = await supabase.from('personal').insert(row).select().maybeSingle()
  if (svar.error?.code === '23505') {
    throw new ApiError('Koden används redan av någon annan.', { orsak: svar.error, kod: 'dublett' })
  }
  return kravRad(svar, 'lägga till personalen')
}

export async function listObjects() {
  if (!hasSupabase) return clone([...db.objekt].sort((a, b) => a.namn.localeCompare(b.namn, 'sv')))
  const svar = await supabase.from('objekt').select('*').order('namn')
  return kastaVidFel(svar, 'hämta objekten') || []
}

export async function staffObjects(personalId) {
  if (!hasSupabase) return db.personalObjekt.filter(([pid]) => pid === personalId).map(([, oid]) => oid)
  const svar = await supabase.from('personal_objekt').select('objekt_id').eq('personal_id', personalId)
  return (kastaVidFel(svar, 'hämta behörigheterna') || []).map((r) => r.objekt_id)
}

export async function setStaffObjects(personalId, objektIds) {
  if (!hasSupabase) {
    db.personalObjekt = db.personalObjekt.filter(([pid]) => pid !== personalId)
      .concat(objektIds.map((oid) => [personalId, oid]))
    return { ok: true }
  }
  kastaVidFel(
    await supabase.from('personal_objekt').delete().eq('personal_id', personalId),
    'rensa gamla behörigheter'
  )
  if (objektIds.length) {
    kastaVidFel(
      await supabase.from('personal_objekt').insert(objektIds.map((oid) => ({ personal_id: personalId, objekt_id: oid }))),
      'spara behörigheterna'
    )
  }
  return { ok: true }
}

export { INCIDENT_TYPES }
