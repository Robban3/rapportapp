// Hjälpare för tider. Inlägg skrivs som fritext ("18:45" eller "20:45-21:30").
//
// Två saker gör tidshanteringen knepigare än den ser ut:
//
// 1. Nattpass. Ett pass startar 14:30 och slutar 03:00 NÄSTA dygn. Både
//    sorteringen och vilket pass ett inlägg hör till måste utgå från passet,
//    inte från midnatt.
// 2. Lokal tid. Allt här räknar i användarens tidszon. `toISOString()` ger
//    UTC-datum och får svensk sommartid att byta dygn redan kl 22:00.

const DYGN = 24 * 60

// Hur långt före passets start ett inlägg får ligga och ändå räknas som
// "tidigt i passet" i stället för att skjutas till nästa dygn.
const TIDIG_TOLERANS = 60

// Hur länge efter sluttiden passet fortfarande går att skriva i. Det sista
// inlägget ("hänger av bricka, avslutar passet") skrivs nästan alltid några
// minuter efter den utsatta sluttiden.
const SEN_TOLERANS = 60

// Timme då verksamhetsdygnet byter. Ett inlägg kl 02:30 hör till gårdagens
// pass. Kan skrivas över per objekt.
export const BRYTPUNKT_TIMME = 5

function parseKlockslag(text) {
  const t = String(text).trim()

  // Sekunddelen är valfri: Postgres `time`-kolumner kommer tillbaka som
  // "14:30:00" via PostgREST. Utan den här grenen blev varje pass som lästes
  // ur databasen otolkbart, och både passfönstret och sorteringen föll ihop.
  const medSeparator = t.match(/^(\d{1,2})[:.](\d{2})(?:[:.]\d{2}(?:\.\d+)?)?$/)
  if (medSeparator) return validera(+medSeparator[1], +medSeparator[2])

  // "930" → 09:30, "2045" → 20:45. Tidigare tolkades "930" som timme 93.
  const baraSiffror = t.match(/^(\d{3,4})$/)
  if (baraSiffror) {
    const s = baraSiffror[1]
    return validera(+s.slice(0, s.length - 2), +s.slice(-2))
  }

  // "9" → 09:00
  const baraTimme = t.match(/^(\d{1,2})$/)
  if (baraTimme) return validera(+baraTimme[1], 0)

  return null
}

function validera(timme, minut) {
  if (timme > 23 || minut > 59) return null
  return timme * 60 + minut
}

function delar(tid) {
  if (tid === null || tid === undefined) return []
  return String(tid).split(/[-–—]/).map((d) => d.trim()).filter(Boolean)
}

/**
 * Minuter från midnatt för tidens START. Returnerar null om tiden inte går
 * att tolka — tidigare gav ogiltig text tyst 0, vilket la inlägget FÖRST i
 * rapporten i stället för att larma om felet.
 */
export function toMinutes(tid) {
  const d = delar(tid)
  if (!d.length) return null
  return parseKlockslag(d[0])
}

/**
 * Normaliserar fritext till "HH:MM" eller "HH:MM-HH:MM". Null om något led
 * är ogiltigt. Används för att städa inmatningen innan den sparas.
 */
export function normalizeTid(tid) {
  const d = delar(tid)
  if (!d.length || d.length > 2) return null

  const minuter = d.map(parseKlockslag)
  if (minuter.some((m) => m === null)) return null

  return minuter.map(hhmm).join('-')
}

/**
 * Ett enskilt klockslag. Till skillnad från `normalizeTid` tillåts INTE
 * intervall: ett inlägg får gärna stå "20:45-21:30", men ett pass start- och
 * sluttid måste vara enkla klockslag — annars går de inte att lagra i en
 * time-kolumn och Postgres svarar 22P02 bakom ett generiskt fel.
 */
export function normalizeKlockslag(tid) {
  const minuter = parseKlockslag(String(tid ?? '').trim())
  return minuter === null ? null : hhmm(minuter)
}

function hhmm(minuter) {
  const h = Math.floor(minuter / 60) % 24
  const m = minuter % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Sorteringsnyckel: minuter räknat från passets start, så att inlägg efter
 * midnatt hamnar sist på ett nattpass utan att tidiga morgoninlägg på ett
 * dagpass gör det.
 *
 * Utan `passStartTid` faller den tillbaka på minuter från midnatt — gissa
 * inte om skiftet, det var precis vad den gamla hårdkodade 06:00-gränsen
 * gjorde fel.
 *
 * Ogiltiga tider sorteras sist i stället för först.
 */
export function sortKey(tid, passStartTid = null) {
  const mins = toMinutes(tid)
  if (mins === null) return Number.MAX_SAFE_INTEGER

  const start = passStartTid === null ? null : toMinutes(passStartTid)
  if (start === null) return mins

  // Placera tiden i fönstret [start - TIDIG_TOLERANS, start + 24h).
  return (((mins - start + TIDIG_TOLERANS) % DYGN) + DYGN) % DYGN - TIDIG_TOLERANS
}

export function nowHHMM(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Lokalt datum som YYYY-MM-DD. `toISOString()` ger UTC och byter dygn för tidigt. */
export function localISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayISO(d = new Date()) {
  return localISO(d)
}

/** 'YYYY-MM-DD' till en lokal Date vid midnatt. `new Date(datum)` tolkar UTC. */
function datumTillDate(datum) {
  const [ar, manad, dag] = String(datum).split('-').map(Number)
  return new Date(ar, (manad || 1) - 1, dag || 1)
}

/**
 * Passets verkliga tidsfönster.
 *
 * Ett pass är daterat sin STARTDAG, inte den dag det slutar. Ett pass
 * 14:30–03:00 daterat 16 aug löper alltså från 16 aug 14:30 till 17 aug
 * 03:00. Sluttiden hör till nästa dygn så snart den inte ligger efter
 * starttiden — det är hela midnattsregeln, och den behöver ingen gissad
 * brytpunkt eftersom passet bär sina egna tider.
 *
 * Saknas sluttid är passet öppet och löper ett dygn från starten.
 *
 * `giltig` är false om starttiden eller datumet inte går att tolka. Tidigare
 * sattes starten tyst till midnatt i det läget, vilket gjorde att ett trasigt
 * pass såg fullt normalt ut och bara betedde sig fel.
 */
export function passFonster({ datum, starttid, sluttid } = {}) {
  const dag = datumTillDate(datum)
  const startMinut = toMinutes(starttid)
  const giltig = startMinut !== null && !Number.isNaN(dag.getTime())

  // Datumet byggs även för ett ogiltigt pass, så anroparen får ett objekt att
  // läsa `giltig` ur. Värdena i det är då meningslösa — och det ska synas här,
  // inte döljas bakom ett tyst `?? 0` som får midnatt att se avsiktligt ut.
  const start = new Date(dag.getTime())
  start.setMinutes(giltig ? startMinut : 0)

  const slutMinut = toMinutes(sluttid)
  if (slutMinut === null) {
    const slut = new Date(start.getTime())
    slut.setDate(slut.getDate() + 1)
    return { start, slut, overMidnatt: false, oppetSlut: true, giltig }
  }

  const overMidnatt = slutMinut <= startMinut
  const slut = new Date(dag.getTime())
  slut.setMinutes(slutMinut)
  if (overMidnatt) slut.setDate(slut.getDate() + 1)

  return { start, slut, overMidnatt, oppetSlut: false, giltig }
}

/**
 * Är passet igång just nu? Toleransen i båda ändar gör att den som kommer en
 * kvart tidigt, eller skriver sitt sista inlägg strax efter sluttiden, inte
 * låses ute.
 *
 * Ett pass med otolkbara tider räknas som INTE igång. Funktionen är en
 * åtkomstgrind, och en grind som inte vet ska hålla stängt hellre än att
 * släppa in alla på ett godtyckligt midnattsfönster.
 */
export function arPassAktivt(pass, nu = new Date()) {
  const { start, slut, giltig } = passFonster(pass)
  if (!giltig) return false

  const tid = nu.getTime()
  return tid >= start.getTime() - TIDIG_TOLERANS * 60000
      && tid <= slut.getTime() + SEN_TOLERANS * 60000
}

/**
 * Vilket verksamhetsdygn en tidpunkt hör till. Före brytpunkten räknas
 * tidpunkten till föregående dygn, så ett inlägg kl 00:20 hamnar i passet
 * som startade kvällen innan i stället för i ett nytt, tomt pass.
 *
 * Används numera bara som förvalt datum i adminpanelen. Vilket pass en värd
 * släpps in i avgörs av `arPassAktivt`, som läser passets egna tider i
 * stället för att gissa på en fast brytpunkt.
 */
export function verksamhetsdatum(d = new Date(), brytpunktTimme = BRYTPUNKT_TIMME) {
  if (d.getHours() >= brytpunktTimme) return localISO(d)

  const foregaende = new Date(d.getTime())
  foregaende.setDate(foregaende.getDate() - 1)
  return localISO(foregaende)
}
