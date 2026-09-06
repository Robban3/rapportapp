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
const EPOST_MONSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ------------------------------------------------------------------ auth
// Inloggningen sköts av Supabase Auth. Tidigare slogs en PIN upp direkt i
// `personal`-tabellen, vilket innebar att anon-nyckeln — som ligger i
// JS-bundlen — kunde läsa ut allas koder. Lösenordet bor nu i auth.users och
// nås aldrig av klienten.

/** Personalraden för den inloggade, eller null. */
export async function aktuellPersonal() {
  if (!hasSupabase) return null   // demoläget håller sessionen i localStorage

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Via funktion, inte via filter. auth_user_id ligger utanför kolumngranten
  // för `authenticated`, och ett filter på en sådan kolumn nekas — rättigheten
  // gäller varje referens, inte bara det som returneras. Det var precis det som
  // låste ute alla från inloggningen. min_profil() läser auth.uid() serverside.
  const svar = await supabase.rpc('min_profil')
  const rader = kastaVidFel(svar, 'hämta din profil')
  return rader?.[0] || null
}

export async function signIn(epost, losenord) {
  const adress = String(epost || '').trim().toLowerCase()

  if (!hasSupabase) {
    // Demoläget har ingen autentisering: e-posten pekar ut vem du är,
    // lösenordet ignoreras. Det finns ingen riktig data att skydda.
    return clone(db.personal.find((p) => p.epost === adress && p.aktiv) || null)
  }

  const { error } = await supabase.auth.signInWithPassword({ email: adress, password: losenord })
  if (error) {
    throw new ApiError(
      error.message === 'Invalid login credentials'
        ? 'Fel e-post eller lösenord.'
        : 'Kunde inte logga in. Försök igen.',
      { orsak: error, kod: 'inloggning' }
    )
  }

  // Kontot finns i auth men saknar personalrad, eller är avaktiverat. Utan
  // det här beskedet hade värden mötts av en tom objektlista utan förklaring.
  const personal = await aktuellPersonal()
  if (!personal) {
    await supabase.auth.signOut()
    throw new ApiError(
      'Kontot är inte kopplat till någon personal. Be en administratör lägga upp dig.',
      { kod: 'okopplad' }
    )
  }
  return personal
}

export async function signOut() {
  if (hasSupabase) await supabase.auth.signOut()
}

/**
 * Skickar en återställningslänk.
 *
 * Svaret säger ALDRIG om adressen finns eller inte. Ett "den adressen är
 * okänd" gör inloggningssidan till ett sätt att lista ut vilka som jobbar
 * här — och det är precis vad appen i övrigt håller stängt.
 */
export async function begarAterstallning(epost) {
  const adress = String(epost || '').trim().toLowerCase()
  if (!EPOST_MONSTER.test(adress)) {
    throw new ApiError('E-postadressen ser inte giltig ut.', { kod: 'ogiltig_epost' })
  }

  if (!hasSupabase) {
    throw new ApiError('Lösenord hanteras av Supabase Auth. Demoläget har ingen inloggning.', { kod: 'demolage' })
  }

  const { error } = await supabase.auth.resetPasswordForEmail(adress, {
    redirectTo: `${window.location.origin}/nytt-losenord`
  })

  // Supabase strypar antalet utskick per adress och timme. Det felet är det
  // enda som är värt att visa — resten skulle avslöja om adressen finns.
  if (error) {
    throw new ApiError(
      /rate|limit|too many/i.test(error.message)
        ? 'För många försök. Vänta en stund och försök igen.'
        : 'Kunde inte skicka återställningen. Försök igen.',
      { orsak: error, kod: 'aterstallning' }
    )
  }
  return { ok: true }
}

/**
 * Sätter ett nytt lösenord för den som just klickat på återställningslänken.
 *
 * Länken loggar in personen med en tillfällig session, så anropet nedan
 * gäller alltid rätt konto — det går inte att ändra någon annans lösenord.
 */
export async function settNyttLosenord(losenord) {
  const nytt = String(losenord || '')
  if (nytt.length < 8) {
    throw new ApiError('Lösenordet måste vara minst 8 tecken.', { kod: 'for_kort' })
  }

  if (!hasSupabase) {
    throw new ApiError('Lösenord hanteras av Supabase Auth. Demoläget har ingen inloggning.', { kod: 'demolage' })
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new ApiError(
      'Länken har gått ut eller är redan använd. Begär en ny återställning.',
      { kod: 'ingen_session' }
    )
  }

  const { error } = await supabase.auth.updateUser({ password: nytt })
  if (error) {
    throw new ApiError(
      /should be different|same/i.test(error.message)
        ? 'Det nya lösenordet måste skilja sig från det gamla.'
        : 'Kunde inte spara lösenordet. Försök igen.',
      { orsak: error, kod: 'byte_misslyckades' }
    )
  }

  // Personalraden hämtas här så anroparen kan sätta sessionen direkt och
  // slippa en extra inloggning efter bytet.
  return aktuellPersonal()
}

/** Kallas när Supabase byter sessionstillstånd (inloggning, utloggning, token-förnyelse). */
export function onAuthChange(callback) {
  if (!hasSupabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange(() => { callback() })
  return () => data.subscription.unsubscribe()
}

// -------------------------------------------------------- objekt för person
export async function objectsForStaff(personalId) {
  if (!hasSupabase) {
    const ids = db.personalObjekt.filter(([pid]) => pid === personalId).map(([, oid]) => oid)
    return clone(db.objekt.filter((o) => ids.includes(o.id) && o.aktiv))
  }
  const svar = await supabase
    .from('personal_objekt')
    .select('objekt:objekt_id ( * )')
    .eq('personal_id', personalId)
  const data = kastaVidFel(svar, 'hämta dina objekt')
  return (data || []).map((r) => r.objekt).filter((o) => o && o.aktiv)
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

  // Omsorteringen görs i databasen. Tidigare kördes en update per inlägg
  // härifrån — men ingen roll har UPDATE på inlagg, så varje sådan skrivning
  // nekades med 42501. Passets tid ändrades ändå, och inläggen låg kvar
  // sorterade mot den gamla starttiden: fel ordning i rapporten till kund,
  // utan att något såg trasigt ut. Ett pass med 80 inlägg gav dessutom 80
  // sekventiella anrop från en telefon.
  kastaVidFel(
    await supabase.rpc('sortera_om_pass', { p_pass_id: passId }),
    'sortera om inläggen'
  )
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
/**
 * Lägger rättelsen direkt efter sitt original i stället för på sin egen tid.
 *
 * En rättelse skriven 23:00 om ett inlägg 22:10 hör ihop med 22:10. Sorterad
 * på sin egen tid hade kunden läst felet först och rättelsen en timme senare.
 */
function ordnaMedRattelser(rader) {
    const rattelser = new Map()
    for (const i of rader) if (i.rattar_id) rattelser.set(i.rattar_id, i)

    const ordnat = []
    for (const i of rader) {
      if (i.rattar_id) continue                 // placeras vid sitt original
      ordnat.push({ ...i, ar_rattad: rattelser.has(i.id) })
      const rattelse = rattelser.get(i.id)
      if (rattelse) ordnat.push({ ...rattelse, ar_rattad: false })
    }

    // En rättelse vars original inte kom med (ska inte hända, men datan ska
    // aldrig försvinna tyst) läggs sist hellre än att tappas bort.
    const med = new Set(ordnat.map((i) => i.id))
    for (const i of rader) if (!med.has(i.id)) ordnat.push({ ...i, ar_rattad: false })
    return ordnat
}

export async function entriesForPass(passId) {
  if (!hasSupabase) {
    const rader = db.inlagg.filter((i) => i.pass_id === passId)
      .map((i) => ({ ...i, signatur: personalMed(i.personal_id)?.initialer }))
      .sort((a, b) => a.sortnyckel - b.sortnyckel || a.skapad_at.localeCompare(b.skapad_at))
    return ordnaMedRattelser(rader)
  }
  const svar = await supabase
    .from('inlagg')
    .select('*, personal:personal_id ( initialer, namn )')
    .eq('pass_id', passId)
    .order('sortnyckel').order('skapad_at')
  const data = kastaVidFel(svar, 'hämta passloggen')
  return ordnaMedRattelser((data || []).map((i) => ({ ...i, signatur: i.personal?.initialer })))
}

export async function addEntry({ id = null, passId, personalId, tid, meddelande, incidentTyp = null, passStartTid = null, rattarId = null }) {
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
  // Samma regel som pass_oppet() i databasen: både `last` och `skickat` är
  // stängda. Efter att låsning och utskick blev två steg räckte det inte att
  // kolla `skickat` — ett pass som låsts men vars mejl fastnat hade tagit emot
  // nya inlägg, efter att rapporten redan renderats.
  const passet = await passById(passId)
  if (!passet) throw new ApiError('Passet finns inte.', { kod: 'saknas' })
  if (passet.status === 'last' || passet.status === 'skickat') {
    throw new ApiError('Passet är låst och rapporten sammanställd. Be en administratör lägga till rättelsen.', { kod: 'last' })
  }

  // Id:t får komma utifrån. Utkorgen sätter ett innan inlägget lämnar
  // telefonen, så att ett omskick efter ett tappat svar krockar med
  // primärnyckeln i stället för att bli en dubblett i rapporten.
  // sortnyckel och last sätts av databasen: en trigger räknar sortnyckeln ur
  // passets starttid, och kolumnen ligger utanför insert-granten. Skickades
  // den härifrån kunde en värd lägga sitt inlägg först i kundens rapport
  // oavsett klockslag. I demoläget finns ingen databas att luta sig mot.
  const row = {
    pass_id: passId, personal_id: personalId, tid: angivenTid,
    meddelande: text, incident_typ: incidentTyp, rattar_id: rattarId
  }
  if (id) row.id = id

  // Ett inlägg får rättas en gång, och en rättelse får inte rättas. Databasen
  // upprätthåller båda, men i demoläget finns ingen databas att luta sig mot.
  if (rattarId) {
    const original = (hasSupabase ? null : db.inlagg.find((i) => i.id === rattarId))
    if (!hasSupabase) {
      if (!original) throw new ApiError('Inlägget som skulle rättas finns inte.', { kod: 'saknas' })
      if (original.pass_id !== passId) throw new ApiError('Rättelsen hör till ett annat pass.', { kod: 'fel_pass' })
      if (original.rattar_id) throw new ApiError('En rättelse går inte att rätta.', { kod: 'rattelse_av_rattelse' })
      if (db.inlagg.some((i) => i.rattar_id === rattarId)) {
        throw new ApiError('Inlägget är redan rättat.', { kod: 'redan_rattad' })
      }
    }
  }

  if (!hasSupabase) {
    const befintligt = id ? db.inlagg.find((i) => i.id === id) : null
    if (befintligt) return { ...befintligt, signatur: personalMed(befintligt.personal_id)?.initialer }
    const saved = {
      ...row, id: id || db.newId(), last: true,
      sortnyckel: sortKey(angivenTid, passStartTid),
      skapad_at: new Date().toISOString()
    }
    db.inlagg.push(saved)
    return { ...saved, signatur: personalMed(personalId)?.initialer }
  }

  const svar = await supabase.from('inlagg').insert(row).select('*, personal:personal_id ( initialer )').maybeSingle()

  // 23505 = unique_violation. Inlägget ligger redan i databasen: svaret på
  // det första försöket kom bara aldrig fram. Det är alltså en lyckad
  // skrivning, inte ett fel att visa för värden.
  if (svar?.error?.code === '23505' && id) {
    const fanns = kravRad(
      await supabase.from('inlagg').select('*, personal:personal_id ( initialer )').eq('id', id).maybeSingle(),
      'hämta det sparade inlägget'
    )
    return { ...fanns, signatur: fanns.personal?.initialer }
  }

  const data = kravRad(svar, 'spara inlägget')
  return { ...data, signatur: data.personal?.initialer }
}

// --------------------------------------------------------- admin: pass-lista
/**
 * Pass med någon av de angivna statusarna, nyast först.
 *
 * Hämtningen är begränsad. Tidigare fanns varken tak eller filter, så
 * "Skickade" drog hem varje pass som någonsin skickats — med tio objekt och
 * ett pass per natt är det över tretusen rader in i en telefon efter ett år,
 * vid varje sidbesök.
 *
 * `sidstorlek + 1` hämtas för att kunna säga om det finns fler utan en extra
 * räknefråga.
 */
export async function passList(status, { objektId = null, fran = null, till = null, sida = 0, sidstorlek = 50 } = {}) {
  const passar = (p) =>
    status.includes(p.status) &&
    (!objektId || p.objekt_id === objektId) &&
    (!fran || p.datum >= fran) &&
    (!till || p.datum <= till)

  if (!hasSupabase) {
    const alla = db.pass.filter(passar)
      .map((p) => ({ ...p, objekt_namn: db.objekt.find((o) => o.id === p.objekt_id)?.namn }))
      .sort((a, b) => b.datum.localeCompare(a.datum))
    const rader = alla.slice(sida * sidstorlek, sida * sidstorlek + sidstorlek)
    return { rader, fler: alla.length > (sida + 1) * sidstorlek }
  }

  let fraga = supabase.from('pass').select('*, objekt:objekt_id ( namn )').in('status', status)
  if (objektId) fraga = fraga.eq('objekt_id', objektId)
  if (fran) fraga = fraga.gte('datum', fran)
  if (till) fraga = fraga.lte('datum', till)

  const svar = await fraga
    .order('datum', { ascending: false })
    .range(sida * sidstorlek, sida * sidstorlek + sidstorlek)

  const data = kastaVidFel(svar, 'hämta passen') || []
  return {
    rader: data.slice(0, sidstorlek).map((p) => ({ ...p, objekt_namn: p.objekt?.namn })),
    fler: data.length > sidstorlek
  }
}

// ------------------------------------------------- admin: sammanställd rapport
export async function report(passId) {
  const entries = await entriesForPass(passId)
  // Ett rättat inlägg räknas inte — rättelsen bär den gällande taggen. Utan
  // detta hade en felaktig incidenttagg levt kvar i kundens statistik även
  // efter att den rättats.
  const stats = emptyStats()
  for (const e of entries) {
    if (e.ar_rattad) continue
    if (e.incident_typ && stats[e.incident_typ] != null) stats[e.incident_typ]++
  }

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
export async function lockAndSend(passId, { omskick = false } = {}) {
  if (!hasSupabase) {
    // Demoläget har ingen e-post att skicka med. Passet låses ändå, så
    // flödet går att gå igenom, men returvärdet påstår inget annat.
    const p = db.pass.find((x) => x.id === passId)
    if (!p) throw new ApiError('Passet finns inte.', { kod: 'saknas' })
    if (p.status === 'skickat' && !omskick) {
      throw new ApiError('Rapporten är redan skickad.', { kod: 'redan_skickad' })
    }
    const objekt = db.objekt.find((o) => o.id === p.objekt_id)
    // Demoläget skickar inget mejl, så passet stannar i `last` — precis som
    // ett skarpt utskick som inte gick fram. Att sätta `skickat` här hade
    // låtit demon påstå något appen inte gjort.
    p.status = 'last'
    p.utskick_fel = 'Demoläget skickar ingen e-post.'
    return { ok: true, mottagare: objekt?.rapportmottagare || [], utskickat: false, demolage: true }
  }

  // Låsning och utskick är EN operation, och den sker på servern. Gjordes de
  // var för sig från klienten kunde passet låsas utan att mejlet gick iväg —
  // eller tvärtom — utan att någon märkte vilket.
  const { data, error } = await supabase.functions.invoke('skicka-rapport', {
    body: { passId, omskick }
  })

  if (error) {
    // Funktionens egna felmeddelanden är skrivna för administratören och är
    // mer användbara än "Edge Function returned a non-2xx status code".
    let text = 'Kunde inte skicka rapporten.'
    try {
      const kropp = await error.context?.json()
      if (kropp?.fel) text = kropp.fel
    } catch { /* inget svar att läsa: behåll den allmänna texten */ }
    throw new ApiError(text, { orsak: error, kod: 'utskick' })
  }

  return { ok: true, mottagare: data?.mottagare || [], utskickat: Boolean(data?.skickat) }
}

/**
 * Bjuder in personen till Supabase Auth via Edge Function `bjud-in`.
 *
 * Anropet går inte direkt mot admin-API:t: det kräver service_role-nyckeln,
 * som går förbi all RLS och därför aldrig får ligga i webbläsaren. Funktionen
 * kontrollerar serversidan att anroparen är admin.
 */
export async function bjudInPersonal(epost) {
  if (!hasSupabase) {
    throw new ApiError(
      'Inbjudan kräver ett kopplat Supabase-projekt. Demoläget har ingen autentisering.',
      { kod: 'demolage' }
    )
  }

  const { data, error } = await supabase.functions.invoke('bjud-in', {
    body: { epost: String(epost || '').trim().toLowerCase() }
  })

  if (error) {
    // Funktionens egna felmeddelanden ligger i svarskroppen, inte i
    // error.message — utan det här får admin bara "non-2xx status code".
    let text = 'Kunde inte skicka inbjudan.'
    try {
      const kropp = await error.context?.json()
      if (kropp?.fel) text = kropp.fel
    } catch { /* behåll standardtexten */ }
    throw new ApiError(text, { orsak: error, kod: 'inbjudan' })
  }
  return data
}

// ----------------------------------------------- admin: personal & behörighet
export async function listStaff() {
  if (!hasSupabase) return clone([...db.personal].sort((a, b) => a.initialer.localeCompare(b.initialer, 'sv')))
  // Adminpanelen visar e-post och om ett konto finns. Kolumnrättigheter kan
  // inte skilja admin från värd — båda är rollen `authenticated` — så rollen
  // kontrolleras i funktionen i stället.
  const svar = await supabase.rpc('personal_for_admin')
  return kastaVidFel(svar, 'hämta personalen') || []
}

export async function addStaff({ namn, initialer, roll, epost }) {
  const row = {
    namn: String(namn || '').trim(), initialer: String(initialer || '').trim(),
    roll, epost: String(epost || '').trim().toLowerCase(), aktiv: true
  }
  if (!row.namn || !row.initialer || !row.epost) {
    throw new ApiError('Namn, signatur och e-post måste fyllas i.', { kod: 'ofullstandig' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.epost)) {
    throw new ApiError('E-postadressen ser inte giltig ut.', { kod: 'ogiltig_epost' })
  }

  if (!hasSupabase) {
    if (db.personal.some((p) => p.epost === row.epost)) {
      throw new ApiError('E-postadressen används redan av någon annan.', { kod: 'dublett' })
    }
    const saved = { ...row, id: db.newId() }
    db.personal.push(saved)
    return clone(saved)
  }

  const svar = await supabase.from('personal').insert(row)
    .select('id, namn, initialer, roll, aktiv').maybeSingle()
  if (svar.error?.code === '23505') {
    throw new ApiError('E-postadressen används redan av någon annan.', { orsak: svar.error, kod: 'dublett' })
  }
  return kravRad(svar, 'lägga till personalen')
}

export async function listObjects({ inklInaktiva = false } = {}) {
  if (!hasSupabase) {
    return clone(db.objekt.filter((o) => inklInaktiva || o.aktiv))
      .sort((a, b) => a.namn.localeCompare(b.namn, 'sv'))
  }
  let fraga = supabase.from('objekt').select('*').order('namn')
  if (!inklInaktiva) fraga = fraga.eq('aktiv', true)
  return kastaVidFel(await fraga, 'hämta objekten') || []
}

// ----------------------------------------------------------- admin: objekt

/**
 * Städar ett objektformulär till databasens form.
 *
 * Rapportmottagarna är en lista, inte ett fält: rapporten går sällan till en
 * enda adress. Tomma rader tas bort, adresserna normaliseras och dubbletter
 * fälls ihop, så att samma mottagare inte får rapporten två gånger.
 */
function stadaObjekt(form) {
  const namn = String(form.namn || '').trim()
  if (!namn) throw new ApiError('Objektet måste ha ett namn.', { kod: 'ofullstandig' })

  const kod = String(form.kod || '').trim().toUpperCase() || null

  const mottagare = []
  for (const rad of form.rapportmottagare || []) {
    const adress = String(rad || '').trim().toLowerCase()
    if (!adress) continue
    if (!EPOST_MONSTER.test(adress)) {
      throw new ApiError(`"${adress}" ser inte ut som en e-postadress.`, { kod: 'ogiltig_epost' })
    }
    if (!mottagare.includes(adress)) mottagare.push(adress)
  }

  const tid = (v, etikett) => {
    const rat = String(v ?? '').trim()
    if (!rat) return null
    const tolkad = normalizeKlockslag(rat)
    if (!tolkad) throw new ApiError(`${etikett} går inte att tolka. Skriv den som HH:MM.`, { kod: 'ogiltig_tid' })
    return tolkad
  }

  const text = (v) => {
    const rat = String(v ?? '').trim()
    return rat || null
  }

  return {
    namn, kod, rapportmottagare: mottagare,
    standard_starttid: tid(form.standard_starttid, 'Standardstarttiden'),
    standard_sluttid: tid(form.standard_sluttid, 'Standardsluttiden'),
    kontaktperson: text(form.kontaktperson),
    kontakt_telefon: text(form.kontakt_telefon),
    instruktioner: text(form.instruktioner)
  }
}

export async function addObject(form) {
  const rad = { ...stadaObjekt(form), aktiv: true }

  if (!hasSupabase) {
    if (rad.kod && db.objekt.some((o) => o.kod === rad.kod)) {
      throw new ApiError('Objektkoden används redan.', { kod: 'dublett' })
    }
    const sparat = { ...rad, id: db.newId() }
    db.objekt.push(sparat)
    return clone(sparat)
  }

  const svar = await supabase.from('objekt').insert(rad).select().maybeSingle()
  if (svar.error?.code === '23505') {
    throw new ApiError('Objektkoden används redan.', { orsak: svar.error, kod: 'dublett' })
  }
  return kravRad(svar, 'lägga till objektet')
}

export async function updateObject(objektId, form) {
  const rad = stadaObjekt(form)

  if (!hasSupabase) {
    const o = db.objekt.find((x) => x.id === objektId)
    if (!o) throw new ApiError('Objektet finns inte.', { kod: 'saknas' })
    if (rad.kod && db.objekt.some((x) => x.kod === rad.kod && x.id !== objektId)) {
      throw new ApiError('Objektkoden används redan.', { kod: 'dublett' })
    }
    Object.assign(o, rad)
    return clone(o)
  }

  const svar = await supabase.from('objekt').update(rad).eq('id', objektId).select().maybeSingle()
  if (svar.error?.code === '23505') {
    throw new ApiError('Objektkoden används redan.', { orsak: svar.error, kod: 'dublett' })
  }
  return kravRad(svar, 'spara objektet')
}

/**
 * Objekt raderas aldrig, bara inaktiveras.
 *
 * Främmande nycklarna kaskaderar: en radering skulle ta med sig objektets alla
 * pass, all bemanning och alla inlägg — inklusive rapporter som redan gått till
 * kund. Inaktivering döljer objektet i listorna och lämnar historiken orörd.
 */
export async function setObjectAktiv(objektId, aktiv) {
  if (!hasSupabase) {
    const o = db.objekt.find((x) => x.id === objektId)
    if (!o) throw new ApiError('Objektet finns inte.', { kod: 'saknas' })
    o.aktiv = Boolean(aktiv)
    return clone(o)
  }
  return kravRad(
    await supabase.from('objekt').update({ aktiv: Boolean(aktiv) }).eq('id', objektId).select().maybeSingle(),
    aktiv ? 'aktivera objektet' : 'inaktivera objektet'
  )
}

/**
 * Stänger av eller öppnar upp en person.
 *
 * `aktiv` är den spärr som redan gäller överallt: inloggningen kräver den,
 * och RLS-hjälparna i databasen (aktuell_personal_id, ar_admin, ar_bemannad)
 * kollar den vid varje anrop. Den som stängs av tappar alltså åtkomsten på
 * riktigt — inte bara i gränssnittet — även om hen sitter kvar med en giltig
 * session. Vägen att sätta den saknades dock, så en värd som slutade behöll
 * sin åtkomst tills någon gick in i Supabase-panelen.
 *
 * Personalraden raderas aldrig. Gamla inlägg är signerade med den, och en
 * rapport som tappar sin signatur är inte längre ett underlag.
 */
export async function setStaffAktiv(personalId, aktiv) {
  const pa = Boolean(aktiv)

  if (!pa) {
    // Två spärrar mot att låsa ut sig själv eller hela företaget. Att bli av
    // med administratören kräver annars en resa till Supabase-panelen — precis
    // det den här funktionen finns för att slippa.
    const jag = await aktuellPersonal()
    if (jag && jag.id === personalId) {
      throw new ApiError('Du kan inte stänga av dig själv.', { kod: 'sig_sjalv' })
    }

    const personal = await listStaff()
    const den = personal.find((p) => p.id === personalId)
    if (!den) throw new ApiError('Personen finns inte.', { kod: 'saknas' })

    const kvarvarandeAdmins = personal.filter((p) => p.aktiv && p.roll === 'Admin' && p.id !== personalId)
    if (den.roll === 'Admin' && kvarvarandeAdmins.length === 0) {
      throw new ApiError(
        'Det måste finnas minst en aktiv administratör. Gör någon annan till admin först.',
        { kod: 'sista_admin' }
      )
    }
  }

  if (!hasSupabase) {
    const person = db.personal.find((x) => x.id === personalId)
    if (!person) throw new ApiError('Personen finns inte.', { kod: 'saknas' })
    person.aktiv = pa
    return clone(person)
  }

  return kravRad(
    await supabase.from('personal').update({ aktiv: pa }).eq('id', personalId)
      .select('id, namn, initialer, roll, aktiv').maybeSingle(),
    pa ? 'aktivera personen' : 'stänga av personen'
  )
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

// ------------------------------------------------------- veckoschema
// Så här ser en normalvecka ut på objektet. Schemat SKAPAR pass — det styr
// dem inte. Ett pass som lagts upp ändras aldrig i efterhand av schemat, så
// en enskild kväll som avviker (sjukdom, extrapersonal, andra tider) rättas
// på passet och står kvar.

export const VECKODAGAR = [
  { nr: 1, namn: 'Måndag', kort: 'Mån' },
  { nr: 2, namn: 'Tisdag', kort: 'Tis' },
  { nr: 3, namn: 'Onsdag', kort: 'Ons' },
  { nr: 4, namn: 'Torsdag', kort: 'Tor' },
  { nr: 5, namn: 'Fredag', kort: 'Fre' },
  { nr: 6, namn: 'Lördag', kort: 'Lör' },
  { nr: 7, namn: 'Söndag', kort: 'Sön' }
]

function schemaTid(varde, vad, kravs) {
  const rat = String(varde ?? '').trim()
  if (!rat) {
    if (kravs) throw new ApiError(`${vad} måste anges.`, { kod: 'ofullstandig' })
    return null
  }
  const tolkad = normalizeKlockslag(rat)
  if (!tolkad) throw new ApiError(`${vad} går inte att tolka. Skriv den som HH:MM.`, { kod: 'ogiltig_tid' })
  return tolkad
}

/** Schemaraderna för ett objekt, med standardbemanningen på varje rad. */
export async function listSchema(objektId) {
  if (!objektId) return []

  if (!hasSupabase) {
    return db.objektSchema.filter((r) => r.objekt_id === objektId)
      .sort((a, b) => a.veckodag - b.veckodag)
      .map((r) => ({
        ...r,
        personal: db.schemaPersonal.filter((sp) => sp.schema_id === r.id).map((sp) => ({
          ...sp,
          initialer: personalMed(sp.personal_id)?.initialer,
          namn: personalMed(sp.personal_id)?.namn
        }))
      }))
  }

  const svar = await supabase
    .from('objekt_schema')
    .select('*, schema_personal ( *, personal:personal_id ( initialer, namn ) )')
    .eq('objekt_id', objektId)
    .order('veckodag')
  const data = kastaVidFel(svar, 'hämta veckoschemat')
  return (data || []).map((r) => ({
    ...r,
    personal: (r.schema_personal || []).map((sp) => ({
      ...sp, initialer: sp.personal?.initialer, namn: sp.personal?.namn
    }))
  }))
}

/** Lägger upp eller uppdaterar en veckodag på objektet. */
export async function setSchemaRad(objektId, veckodag, { starttid, sluttid = null, aktiv = true } = {}) {
  if (!objektId) throw new ApiError('Objekt måste anges.', { kod: 'ofullstandig' })
  const dag = Number(veckodag)
  if (!Number.isInteger(dag) || dag < 1 || dag > 7) {
    throw new ApiError('Veckodagen måste vara 1–7 (måndag–söndag).', { kod: 'ogiltig_veckodag' })
  }

  // Starttiden är obligatorisk: den styr både när loggen öppnar och hur
  // inläggen sorteras. Sluttiden får saknas — den fylls ibland i senare.
  const rad = {
    objekt_id: objektId, veckodag: dag,
    starttid: schemaTid(starttid, 'Starttiden', true),
    sluttid: schemaTid(sluttid, 'Sluttiden', false),
    aktiv: !!aktiv
  }

  if (!hasSupabase) {
    const i = db.objektSchema.findIndex((r) => r.objekt_id === objektId && r.veckodag === dag)
    if (i >= 0) {
      db.objektSchema[i] = { ...db.objektSchema[i], ...rad }
      return clone(db.objektSchema[i])
    }
    const ny = { ...rad, id: db.newId(), skapad_at: new Date().toISOString() }
    db.objektSchema.push(ny)
    return clone(ny)
  }

  return kravRad(
    await supabase.from('objekt_schema').upsert(rad, { onConflict: 'objekt_id,veckodag' }).select().maybeSingle(),
    'spara schemaraden'
  )
}

export async function removeSchemaRad(schemaId) {
  if (!hasSupabase) {
    db.schemaPersonal = db.schemaPersonal.filter((sp) => sp.schema_id !== schemaId)
    const i = db.objektSchema.findIndex((r) => r.id === schemaId)
    if (i >= 0) db.objektSchema.splice(i, 1)
    return { ok: true }
  }
  kastaVidFel(await supabase.from('objekt_schema').delete().eq('id', schemaId), 'ta bort schemaraden')
  return { ok: true }
}

/** Lägger någon i standardbemanningen för en veckodag. */
export async function setSchemaPersonal(schemaId, personalId, { roll = null, tid_in = null, tid_ut = null } = {}) {
  if (!schemaId || !personalId) throw new ApiError('Schemarad och person måste anges.', { kod: 'ofullstandig' })

  const rad = {
    schema_id: schemaId, personal_id: personalId, roll,
    tid_in: schemaTid(tid_in, 'Tiden in', false),
    tid_ut: schemaTid(tid_ut, 'Tiden ut', false)
  }

  if (!hasSupabase) {
    const i = db.schemaPersonal.findIndex((sp) => sp.schema_id === schemaId && sp.personal_id === personalId)
    if (i >= 0) db.schemaPersonal[i] = rad
    else db.schemaPersonal.push(rad)
    return { ...rad, initialer: personalMed(personalId)?.initialer, namn: personalMed(personalId)?.namn }
  }

  const data = kravRad(
    await supabase.from('schema_personal').upsert(rad, { onConflict: 'schema_id,personal_id' })
      .select('*, personal:personal_id ( initialer, namn )').maybeSingle(),
    'spara standardbemanningen'
  )
  return { ...data, initialer: data.personal?.initialer, namn: data.personal?.namn }
}

export async function removeSchemaPersonal(schemaId, personalId) {
  if (!hasSupabase) {
    const i = db.schemaPersonal.findIndex((sp) => sp.schema_id === schemaId && sp.personal_id === personalId)
    if (i >= 0) db.schemaPersonal.splice(i, 1)
    return { ok: true }
  }
  kastaVidFel(
    await supabase.from('schema_personal').delete().eq('schema_id', schemaId).eq('personal_id', personalId),
    'ta bort personen ur schemat'
  )
  return { ok: true }
}

/**
 * Skapar pass ur schemat för de kommande dagarna, för ALLA aktiva objekt.
 *
 * Idempotent: en dag som redan har ett pass lämnas orörd. Returnerar hur många
 * pass som faktiskt skapades och hur många dagar som redan var upplagda, så
 * adminpanelen kan säga vad som hände i stället för bara "klart".
 */
export async function skapaPassFranSchema(dagar = 14) {
  const antal = Number(dagar)
  if (!Number.isInteger(antal) || antal < 1 || antal > 90) {
    throw new ApiError('Antal dagar måste vara mellan 1 och 90.', { kod: 'ogiltigt_antal' })
  }

  if (!hasSupabase) {
    let skapade = 0
    let fanns = 0
    const idag = new Date()
    for (let n = 0; n < antal; n++) {
      const d = new Date(idag)
      d.setDate(d.getDate() + n)
      // getDay(): 0 = söndag. Schemat är ISO, där söndag är 7.
      const veckodag = d.getDay() === 0 ? 7 : d.getDay()
      const datum = localISO(d)

      for (const rad of db.objektSchema) {
        if (!rad.aktiv || rad.veckodag !== veckodag) continue
        if (!db.objekt.find((o) => o.id === rad.objekt_id)?.aktiv) continue
        if (db.pass.some((p) => p.objekt_id === rad.objekt_id && p.datum === datum)) { fanns++; continue }

        const nyttPass = {
          id: db.newId(), objekt_id: rad.objekt_id, datum,
          starttid: rad.starttid, sluttid: rad.sluttid, status: 'oppet'
        }
        db.pass.push(nyttPass)
        for (const sp of db.schemaPersonal.filter((x) => x.schema_id === rad.id)) {
          db.passPersonal.push({
            pass_id: nyttPass.id, personal_id: sp.personal_id,
            roll: sp.roll, tid_in: sp.tid_in, tid_ut: sp.tid_ut
          })
        }
        skapade++
      }
    }
    return { skapade, fanns }
  }

  // Generatorn ligger i databasen. Den skriver i pass och pass_personal, som
  // bara admin får röra, och kontrollerar därför själv att anroparen är admin.
  const data = kastaVidFel(
    await supabase.rpc('skapa_pass_fran_schema', { p_dagar: antal }),
    'skapa pass ur schemat'
  )
  const rader = data || []
  return {
    skapade: rader.filter((r) => r.skapat).length,
    fanns: rader.filter((r) => !r.skapat).length
  }
}

export { INCIDENT_TYPES }
