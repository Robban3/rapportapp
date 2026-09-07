// PDF-bilagan till rapporten.
//
// Mejlet är det som läses — en receptionschef öppnar det i telefonen. PDF:en är
// det som arkiveras: försäkring, myndighet, en tvist ett halvår senare. Samma
// innehåll, enklare layout.
//
// Edge Functions kan inte köra en webbläsare, så den går inte att rendera ur
// HTML-mallen. Den ritas i stället, och därför ligger all logik som kan bli fel
// — radbrytning, sidindelning, teckenkodning — i rena funktioner som testas
// från apptesterna. pdf-lib rör bara själva ritandet.

import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'
import { incidentText, INCIDENT_TEXT, type RapportData } from './rapport-html.ts'

// A4 i punkter, och en marginal som ger plats åt sidfoten.
const SIDBREDD = 595.28
const SIDHOJD = 841.89
const MARGINAL = 50
const INNEHALL = SIDBREDD - MARGINAL * 2
const TIDSPALT = 52

const SVART = rgb(0.055, 0.11, 0.094)
const GRA = rgb(0.42, 0.5, 0.475)
const ACCENT = rgb(0.05, 0.58, 0.53)
const LINJE = rgb(0.867, 0.906, 0.89)

/** En rad att rita. Data, inget ritande — så att sidindelningen går att testa. */
export type Rad =
  | { typ: 'luft'; hojd: number }
  | { typ: 'rubrik'; text: string }
  | { typ: 'meta'; text: string }
  | { typ: 'sektion'; text: string }
  | { typ: 'tom'; text: string }
  | { typ: 'personal'; sign: string; namn: string; roll: string; tider: string }
  | { typ: 'inlagg'; tid: string; text: string; struken: boolean }
  | { typ: 'signatur'; text: string; markning: string; accent: boolean }
  | { typ: 'statistik'; antal: string; text: string }

/** Höjden varje radtyp tar. Sidindelningen räknar med den, ritandet följer den. */
export function radhojd(rad: Rad): number {
  switch (rad.typ) {
    case 'luft': return rad.hojd
    case 'rubrik': return 24
    case 'meta': return 15
    case 'sektion': return 22
    case 'tom': return 16
    case 'personal': return 15
    case 'inlagg': return 14
    case 'signatur': return 15
    case 'statistik': return 15
  }
}

/**
 * Tecken som WinAnsi inte kan koda byts ut.
 *
 * Utan det här kastar pdf-lib mitt i genereringen så fort någon skrivit en
 * emoji i ett inlägg — och då hade hela rapporten stannat på grund av en
 * tumme upp. Svenska tecken, tankstreck och citattecken finns i WinAnsi och
 * passerar orörda.
 */
const CP1252_EXTRA = new Set(
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split('').map((c) => c.codePointAt(0)!)
)

export function sanera(text: unknown): string {
  const rat = String(text ?? '')
  let ut = ''
  for (const tecken of rat) {
    const kod = tecken.codePointAt(0)!
    if (tecken === '\n' || tecken === '\r' || tecken === '\t') { ut += ' '; continue }
    if ((kod >= 0x20 && kod <= 0x7e) || (kod >= 0xa0 && kod <= 0xff) || CP1252_EXTRA.has(kod)) {
      ut += tecken
    } else {
      // Ett frågetecken är ärligare än att tyst tappa tecknet: läsaren ser att
      // något stod där.
      ut += '?'
    }
  }
  return ut
}

/**
 * Bryter text till rader som ryms inom `bredd`.
 *
 * `mat` mäter en sträng. Den skickas in i stället för att slås upp, så att
 * brytningen går att testa utan att ladda ett typsnitt.
 */
export function radbryt(text: string, bredd: number, mat: (t: string) => number): string[] {
  const ord = sanera(text).split(/\s+/).filter(Boolean)
  if (ord.length === 0) return ['']

  const rader: string[] = []
  let rad = ''

  const brytHart = (langt: string) => {
    // En klistrad URL har inga mellanslag att bryta på. Utan det här hade den
    // ritats rakt ut över sidkanten.
    let bit = ''
    for (const tecken of langt) {
      if (mat(bit + tecken) > bredd && bit) { rader.push(bit); bit = tecken }
      else bit += tecken
    }
    return bit
  }

  for (const o of ord) {
    const forslag = rad ? `${rad} ${o}` : o
    if (mat(forslag) <= bredd) { rad = forslag; continue }
    if (rad) { rader.push(rad); rad = '' }
    rad = mat(o) > bredd ? brytHart(o) : o
  }
  if (rad) rader.push(rad)
  return rader
}

/**
 * Delar raderna i sidor.
 *
 * Två rader får inte skiljas åt av ett sidbrott: en sektionsrubrik ska aldrig
 * bli ensam sist, och en signatur ska aldrig hamna överst på nästa sida utan
 * inlägget den hör till. Båda ser ut som att rapporten tappat något.
 * Ett långt inlägg får däremot brytas mitt i — det syns på tidstämpeln att
 * texten hör ihop.
 */
function foljerMed(foregaende: Rad, rad: Rad): boolean {
  if (foregaende.typ === 'sektion') return true
  return rad.typ === 'signatur' && foregaende.typ === 'inlagg'
}

export function sidindela(rader: Rad[], tillganglig: number): Rad[][] {
  const sidor: Rad[][] = []
  let sida: Rad[] = []
  let y = 0

  for (const rad of rader) {
    const h = radhojd(rad)

    if (y + h > tillganglig && sida.length > 0) {
      // Bara om det som följer med inte tömmer sidan helt — annars blir
      // brytningen ett varv utan slut.
      const foregaende = sida[sida.length - 1]
      if (sida.length > 1 && foljerMed(foregaende, rad)) {
        sida.pop()
        sidor.push(sida)
        sida = [foregaende, rad]
        y = radhojd(foregaende) + h
        continue
      }
      sidor.push(sida)
      sida = []
      y = 0
    }

    // Luft överst på en ny sida vore bara ett hål.
    if (sida.length === 0 && rad.typ === 'luft') continue
    sida.push(rad)
    y += h
  }

  if (sida.length > 0) sidor.push(sida)
  return sidor.length > 0 ? sidor : [[]]
}

/** Bygger rapportens rader. `mat` mäter brödtext i 10 punkter. */
export function byggRader(data: RapportData, mat: (t: string) => number): Rad[] {
  const { objekt, pass, roster, entries, stats } = data
  const rader: Rad[] = []

  rader.push({ typ: 'rubrik', text: sanera(objekt.namn) })
  rader.push({
    typ: 'meta',
    text: sanera(`Pass ${pass.datum} · ${pass.starttid || '—'}–${pass.sluttid || '—'} · `
      + `${roster.length} i personalen · ${entries.length} inlägg`)
  })

  rader.push({ typ: 'sektion', text: 'Personal på passet' })
  if (roster.length === 0) {
    rader.push({ typ: 'tom', text: 'Ingen personal registrerad på passet.' })
  } else {
    for (const r of roster) {
      rader.push({
        typ: 'personal',
        sign: sanera(r.initialer), namn: sanera(r.namn), roll: sanera(r.roll),
        tider: sanera(`${r.tid_in || '—'}–${r.tid_ut || '—'}`)
      })
    }
  }

  rader.push({ typ: 'luft', hojd: 10 })
  rader.push({ typ: 'sektion', text: 'Anteckningar' })

  if (entries.length === 0) {
    rader.push({ typ: 'tom', text: 'Inget skrevs i passet.' })
  } else {
    for (const e of entries) {
      // Ett rättat inlägg står kvar överstruket med rättelsen under. Samma
      // regel som i mejlet — inget tas bort ur en rapport.
      const brutna = radbryt(e.meddelande, INNEHALL - TIDSPALT, mat)
      brutna.forEach((text, n) => {
        rader.push({ typ: 'inlagg', tid: n === 0 ? sanera(e.tid) : '', text, struken: Boolean(e.ar_rattad) })
      })
      rader.push({
        typ: 'signatur',
        text: sanera(e.signatur || ''),
        markning: e.ar_rattad ? 'RÄTTAD' : e.rattar_id ? 'RÄTTELSE' : '',
        accent: Boolean(e.rattar_id)
      })
      rader.push({ typ: 'luft', hojd: 6 })
    }
  }

  const taggade = Object.keys(INCIDENT_TEXT).filter((k) => (stats[k] || 0) > 0)
  if (taggade.length > 0) {
    rader.push({ typ: 'luft', hojd: 8 })
    rader.push({ typ: 'sektion', text: 'Sammanfattning' })
    for (const k of taggade) {
      rader.push({ typ: 'statistik', antal: String(stats[k]), text: sanera(incidentText(k, stats[k])) })
    }
  }

  return rader
}

/** Filnamn utan tecken som inte hör hemma i ett sådant. */
export function filnamn(data: RapportData): string {
  const namn = sanera(data.objekt.namn).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'rapport'
  return `Raptr ${namn} ${data.pass.datum}.pdf`
}

export async function renderaPdf(data: RapportData): Promise<Uint8Array> {
  const dok = await PDFDocument.create()
  const vanlig = await dok.embedFont(StandardFonts.Helvetica)
  const fet = await dok.embedFont(StandardFonts.HelveticaBold)
  const mono = await dok.embedFont(StandardFonts.Courier)
  const monoFet = await dok.embedFont(StandardFonts.CourierBold)

  dok.setTitle(`Rapport ${sanera(data.objekt.namn)} ${data.pass.datum}`)
  dok.setCreator('Raptr')

  const mat = (t: string) => vanlig.widthOfTextAtSize(t, 10)
  const rader = byggRader(data, mat)
  const sidor = sidindela(rader, SIDHOJD - MARGINAL * 2 - 24)   // 24 = sidfoten

  sidor.forEach((sidrader, index) => {
    const sida = dok.addPage([SIDBREDD, SIDHOJD])
    let y = SIDHOJD - MARGINAL

    for (const rad of sidrader) {
      y -= radhojd(rad)
      const x = MARGINAL

      switch (rad.typ) {
        case 'luft':
          break

        case 'rubrik':
          sida.drawText(rad.text, { x, y, size: 17, font: fet, color: SVART })
          break

        case 'meta':
          sida.drawText(rad.text, { x, y, size: 9.5, font: vanlig, color: GRA })
          break

        case 'sektion':
          sida.drawText(rad.text.toUpperCase(), { x, y, size: 8.5, font: fet, color: GRA })
          sida.drawLine({
            start: { x, y: y - 5 }, end: { x: x + INNEHALL, y: y - 5 },
            thickness: 0.7, color: LINJE
          })
          break

        case 'tom':
          sida.drawText(rad.text, { x, y, size: 10, font: vanlig, color: GRA })
          break

        case 'personal':
          sida.drawText(rad.sign, { x, y, size: 9.5, font: fet, color: SVART })
          sida.drawText(rad.namn, { x: x + 60, y, size: 9.5, font: vanlig, color: SVART })
          sida.drawText(rad.roll, { x: x + 190, y, size: 9.5, font: vanlig, color: GRA })
          sida.drawText(rad.tider, { x: x + 330, y, size: 9.5, font: mono, color: GRA })
          break

        case 'inlagg': {
          if (rad.tid) {
            sida.drawText(rad.tid, { x, y, size: 9.5, font: monoFet, color: ACCENT })
          }
          const textX = x + TIDSPALT
          sida.drawText(rad.text, { x: textX, y, size: 10, font: vanlig, color: rad.struken ? GRA : SVART })
          if (rad.struken) {
            // Överstruket, inte borttaget: läsaren ska se vad som först skrevs.
            const bredd = vanlig.widthOfTextAtSize(rad.text, 10)
            sida.drawLine({
              start: { x: textX, y: y + 3 }, end: { x: textX + bredd, y: y + 3 },
              thickness: 0.6, color: GRA
            })
          }
          break
        }

        case 'signatur': {
          const textX = x + TIDSPALT
          sida.drawText(rad.text, { x: textX, y, size: 8, font: fet, color: GRA })
          if (rad.markning) {
            const efter = textX + vanlig.widthOfTextAtSize(rad.text, 8) + 8
            sida.drawText(rad.markning, {
              x: efter, y, size: 7.5, font: fet, color: rad.accent ? ACCENT : GRA
            })
          }
          break
        }

        case 'statistik':
          sida.drawText(rad.antal, { x, y, size: 10, font: monoFet, color: ACCENT })
          sida.drawText(rad.text, { x: x + 26, y, size: 10, font: vanlig, color: SVART })
          break
      }
    }

    const fot = sanera(`${data.objekt.namn} · ${data.pass.datum} · sida ${index + 1} av ${sidor.length}`)
    sida.drawText(fot, { x: MARGINAL, y: MARGINAL - 18, size: 8, font: vanlig, color: GRA })
  })

  return await dok.save()
}

/**
 * Bilagan skickas som base64 i Resends JSON-kropp.
 *
 * `btoa` tar en sträng, inte bytes, och `String.fromCharCode(...bytes)` på en
 * hel PDF spränger anropsstacken. Därför i bitar.
 */
export function base64(bytes: Uint8Array): string {
  let binart = ''
  const bit = 0x8000
  for (let i = 0; i < bytes.length; i += bit) {
    binart += String.fromCharCode(...bytes.subarray(i, i + bit))
  }
  return btoa(binart)
}
