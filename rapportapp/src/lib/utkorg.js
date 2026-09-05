// Utkorg för inlägg som skrivs utan nät.
//
// Ett hotellpass går ofta i källarplan, garage och hisschakt. Skrev värden ett
// inlägg där försvann det tidigare med felmeddelandet — texten låg kvar i
// fältet, men bara tills sidan laddades om. Här läggs inlägget i stället i en
// kö i localStorage och skickas när nätet kommer tillbaka.
//
// Kön är knuten till enheten OCH till personen: loggar någon annan in på
// samma telefon ska inte hens inlägg gå iväg i den förras namn.

import { ApiError } from './errors.js'

const NYCKEL = 'rapportapp.utkorg.v1'

// localStorage saknas i privat läge på vissa webbläsare och kastar då redan
// vid läsning. Kön får aldrig vara det som kraschar passloggen, så den faller
// tillbaka på minnet — sämre, men appen fungerar.
let iMinnet = []
let harLagring = true

function las() {
  if (!harLagring) return iMinnet
  try {
    const rat = localStorage.getItem(NYCKEL)
    const poster = rat ? JSON.parse(rat) : []
    return Array.isArray(poster) ? poster : []
  } catch {
    harLagring = false
    return iMinnet
  }
}

function spara(poster) {
  iMinnet = poster
  if (!harLagring) return
  try {
    localStorage.setItem(NYCKEL, JSON.stringify(poster))
  } catch {
    // Full disk eller privat läge: behåll kön i minnet i stället för att
    // tappa inlägget helt.
    harLagring = false
  }
}

function nyttId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'ko-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Alla köade inlägg för en person och ett pass, äldst först. */
export function koFor(personalId, passId) {
  return las().filter((k) => k.personalId === personalId && k.passId === passId)
}

/** Antal köade inlägg för en person, oavsett pass. */
export function antalIKo(personalId) {
  return las().filter((k) => k.personalId === personalId).length
}

/**
 * Köade inlägg som nekats och alltså aldrig kommer fram av sig själva.
 *
 * Kön töms för hela personen, oavsett pass, men passloggen visar bara det pass
 * man står i. Ett inlägg från gårdagens numera låsta pass felmarkerades därför
 * och försvann ur allas synfält — texten fanns kvar i localStorage, men ingen
 * fick veta att den aldrig nådde rapporten.
 */
export function felmarkerade(personalId) {
  return las().filter((k) => k.personalId === personalId && k.fel)
}

/**
 * Lägger ett inlägg i kön. Id:t sätts här och följer med hela vägen in i
 * databasen — skickas samma inlägg två gånger (svaret tappades bort på vägen)
 * krockar det andra försöket med primärnyckeln i stället för att bli en
 * dubblett i rapporten.
 */
export function laggIKo(post) {
  const rad = {
    // Ett medskickat id behålls. Köas ett inlägg om efter att skrivningen
    // redan gått igenom — nätet tappades mellan skrivning och omhämtning —
    // krockar omskicket med primärnyckeln i stället för att bli en dubblett
    // i kundens rapport.
    id: post.id || nyttId(),
    passId: post.passId,
    personalId: post.personalId,
    tid: post.tid,
    meddelande: post.meddelande,
    incidentTyp: post.incidentTyp ?? null,
    passStartTid: post.passStartTid ?? null,
    rattarId: post.rattarId ?? null,
    skapad: post.skapad ?? new Date().toISOString(),
    fel: null
  }
  spara([...las(), rad])
  return rad
}

/** Tar bort ett köat inlägg, t.ex. när värden själv slänger ett som nekats. */
export function taBortFranKo(id) {
  spara(las().filter((k) => k.id !== id))
}

/** Nollställer felmarkeringen så posten tas med i nästa flush. */
export function forsokIgen(id) {
  spara(las().map((k) => (k.id === id ? { ...k, fel: null } : k)))
}

function markeraFel(id, text) {
  spara(las().map((k) => (k.id === id ? { ...k, fel: text } : k)))
}

/**
 * Skickar kön i tur och ordning.
 *
 * `skicka` är api.addEntry (injiceras för att hålla modulen testbar).
 *
 * Tre utfall per post:
 *  - sparad        → bort ur kön
 *  - nätverksfel   → ligger kvar, och resten av kön väntar (ordningen i
 *                    loggen ska vara den värden skrev i)
 *  - nekad/ogiltig → ligger kvar MED felmarkering. Inget kastas tyst: värden
 *                    får se vad som inte gick fram och kan skriva om det.
 */
export async function flusha(personalId, skicka) {
  const resultat = { sparade: 0, kvar: 0, nyaFel: [] }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    resultat.kvar = antalIKo(personalId)
    return resultat
  }

  for (const post of las().filter((k) => k.personalId === personalId && !k.fel)) {
    try {
      await skicka({
        id: post.id,
        passId: post.passId,
        personalId: post.personalId,
        tid: post.tid,
        meddelande: post.meddelande,
        incidentTyp: post.incidentTyp,
        passStartTid: post.passStartTid,
        rattarId: post.rattarId
      })
      taBortFranKo(post.id)
      resultat.sparade++
    } catch (fel) {
      if (arNatverksfel(fel)) break        // nätet är borta igen: försök senare
      const text = fel instanceof ApiError ? fel.message : 'Inlägget kunde inte sparas.'
      markeraFel(post.id, text)
      resultat.nyaFel.push({ id: post.id, fel: text })
    }
  }

  resultat.kvar = antalIKo(personalId)
  return resultat
}

/**
 * Går felet att vänta ut? Bara nätverksfel köas — ett nekat inlägg (låst pass,
 * fel behörighet) blir inte rätt av att skickas om, och en kö som försöker i
 * evighet döljer att inlägget aldrig kom fram.
 */
export function arNatverksfel(fel) {
  // Fel som datalagret själv kastar (låst pass, ogiltig tid), eller som en
  // server hann svara med (RLS), har en kod. De beror inte på nätet.
  if (fel instanceof ApiError && fel.kod) return false
  const texter = [fel?.message, fel?.orsak?.message, fel?.orsak?.details]
  if (texter.some((t) => typeof t === 'string' && /failed to fetch|networkerror|load failed|network request failed|timeout/i.test(t))) {
    return true
  }
  // Kodlöst fel med enheten offline: nätet är den rimliga förklaringen.
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** Bara för tester: tömmer kön. */
export function nollstall() {
  iMinnet = []
  harLagring = true
  try { localStorage.removeItem(NYCKEL) } catch { /* ingen lagring att tömma */ }
}
