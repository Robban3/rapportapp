import { describe, it, expect } from 'vitest'
import { renderaHtml, textVersion, amne, esc, INCIDENT_TEXT }
  from '../../../supabase/functions/skicka-rapport/rapport-html.ts'
import { INCIDENT_TYPES } from './incidents.js'

// Mallen bor i Edge Function-mappen — Deno bundlar bara sin egen mapp — men
// testas härifrån. Det som skickas till en kund ska inte vara det enda i
// kedjan som ingen kört.

const rad = (extra = {}) => ({
  id: 'i1', tid: '23:15', meddelande: 'Nekar två minderåriga vid entrén.',
  signatur: 'ZÄEM', incident_typ: 'nekad_alder', ar_rattad: false, rattar_id: null, ...extra
})

const data = (extra = {}) => ({
  objekt: { namn: 'Clarion Draken Hotel', kod: 'DRAKEN' },
  pass: { datum: '2026-08-17', starttid: '22:00', sluttid: '06:00' },
  roster: [{ initialer: 'ZÄEM', namn: 'Zäem', roll: 'Värd', tid_in: '22:00', tid_ut: '06:00' }],
  entries: [rad()],
  stats: { nekad_alder: 1 },
  ...extra
})

describe('rapportmallen', () => {
  it('sätter ett ämne som säger objekt och datum', () => {
    expect(amne(data())).toBe('Rapport Clarion Draken Hotel — 2026-08-17')
  })

  it('tar med personal, anteckningar och antal', () => {
    const html = renderaHtml(data())
    expect(html).toContain('Clarion Draken Hotel')
    expect(html).toContain('2026-08-17')
    expect(html).toContain('Nekar två minderåriga vid entrén.')
    expect(html).toContain('ZÄEM')
    expect(html).toContain('1 inlägg')
  })

  it('visar ett rättat inlägg överstruket med rättelsen under', () => {
    const html = renderaHtml(data({
      entries: [
        rad({ ar_rattad: true }),
        rad({ id: 'i2', rattar_id: 'i1', meddelande: 'Rättelse: en minderårig, inte två.' })
      ]
    }))

    // Originalet raderas aldrig ur en rapport.
    expect(html).toContain('Nekar två minderåriga vid entrén.')
    expect(html).toContain('Rättelse: en minderårig, inte två.')
    expect(html).toMatch(/line-through/)
    expect(html).toMatch(/Rättad/)
    expect(html).toMatch(/Rättelse/)
  })

  it('döljer nollrader i sammanfattningen', () => {
    const html = renderaHtml(data({ stats: { nekad_alder: 2, info_alkohol: 0 } }))
    expect(html).toContain('personer nekades pga. ålder/klädkod')
    expect(html).not.toContain('personer informerades om utgång med alkohol')
  })

  it('utelämnar sammanfattningen helt när inget taggats', () => {
    const html = renderaHtml(data({ stats: {} }))
    expect(html).not.toContain('Sammanfattning')
  })

  it('säger till när passet var tomt i stället för att visa en tom tabell', () => {
    expect(renderaHtml(data({ entries: [] }))).toContain('Inget skrevs i passet')
    expect(renderaHtml(data({ roster: [] }))).toContain('Ingen personal registrerad')
  })

  it('klarar ett pass utan sluttid', () => {
    const html = renderaHtml(data({ pass: { datum: '2026-08-17', starttid: '22:00', sluttid: null } }))
    expect(html).toContain('22:00–—')
  })
})

describe('inlägg är text, inte markup', () => {
  it('escapar taggar i ett inlägg', () => {
    const html = renderaHtml(data({
      entries: [rad({ meddelande: '<script>alert(1)</script> & "citat"' })]
    }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })

  it('escapar även signatur och objektnamn', () => {
    const html = renderaHtml(data({
      objekt: { namn: 'Hotell <b>X</b>' },
      entries: [rad({ signatur: '<i>ZÄ</i>' })]
    }))
    expect(html).not.toContain('<b>X</b>')
    expect(html).not.toContain('<i>ZÄ</i>')
  })

  it('esc hanterar null och odefinierat utan att skriva ut "null"', () => {
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
  })
})

describe('textversionen', () => {
  it('innehåller samma uppgifter som HTML-versionen', () => {
    const t = textVersion(data())
    expect(t).toContain('Clarion Draken Hotel')
    expect(t).toContain('23:15')
    expect(t).toContain('Nekar två minderåriga vid entrén.')
    expect(t).toContain('ZÄEM')
  })

  it('märker ut rättelser', () => {
    const t = textVersion(data({
      entries: [rad({ ar_rattad: true }), rad({ id: 'i2', rattar_id: 'i1', meddelande: 'Rättelse.' })]
    }))
    expect(t).toContain('[RÄTTAD]')
    expect(t).toContain('[RÄTTELSE]')
  })
})

describe('incidenttexterna i mallen och i appen', () => {
  it('är samma lista — Edge Functions bundlar bara sin egen mapp, så den finns i två exemplar', () => {
    const iAppen = Object.fromEntries(INCIDENT_TYPES.map((t) => [t.key, t.text]))
    expect(INCIDENT_TEXT).toEqual(iAppen)
  })
})
