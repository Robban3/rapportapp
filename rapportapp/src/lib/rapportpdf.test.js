import { describe, it, expect } from 'vitest'
import {
  sanera, radbryt, sidindela, byggRader, radhojd, filnamn, base64, renderaPdf
} from '../../../supabase/functions/skicka-rapport/rapport-pdf.ts'
import { PDFDocument } from 'pdf-lib'

// PDF-bilagan bor i Edge Function-mappen men testas härifrån, precis som
// HTML-mallen. Allt som kan gå sönder — teckenkodning, radbrytning,
// sidindelning — ligger i rena funktioner just för att kunna köras här.

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

// Mäter en tecken per enhet. Brytningen ska testas som regel, inte mot
// bredden på ett visst typsnitt.
const matBokstav = (t) => t.length

describe('sanera', () => {
  it('släpper igenom svenska tecken, tankstreck och punkt', () => {
    expect(sanera('Åke gick — och sa · "hej"')).toBe('Åke gick — och sa · "hej"')
  })

  it('byter ut emoji i stället för att kasta', () => {
    // Utan det här kastar pdf-lib mitt i genereringen och rapporten stannar
    // på grund av en tumme upp.
    expect(sanera('Allt lugnt 👍')).toBe('Allt lugnt ?')
    expect(sanera('Гость')).toBe('?????')
  })

  it('gör radbrytningar i ett inlägg till mellanslag', () => {
    expect(sanera('rad ett\nrad två')).toBe('rad ett rad två')
  })

  it('tål null och undefined', () => {
    expect(sanera(null)).toBe('')
    expect(sanera(undefined)).toBe('')
  })
})

describe('radbryt', () => {
  it('bryter på ordgräns', () => {
    expect(radbryt('ett två tre fyra', 9, matBokstav)).toEqual(['ett två', 'tre fyra'])
  })

  it('bryter hårt mitt i ett ord som är längre än raden', () => {
    // En klistrad URL har inga mellanslag att bryta på och hade annars ritats
    // rakt ut över sidkanten.
    expect(radbryt('https://exempel.se/en/mycket/lang/adress', 10, matBokstav))
      .toEqual(['https://ex', 'empel.se/e', 'n/mycket/l', 'ang/adress'])
  })

  it('ger en tom rad för tom text', () => {
    expect(radbryt('   ', 20, matBokstav)).toEqual([''])
  })

  it('inga rader blir bredare än bredden', () => {
    const langt = 'Nekar två minderåriga vid entrén och informerar om utgång med alkohol.'
    for (const r of radbryt(langt, 20, matBokstav)) expect(r.length).toBeLessThanOrEqual(20)
  })
})

describe('sidindela', () => {
  const inlagg = (n) => ({ typ: 'inlagg', tid: String(n), text: `rad ${n}`, struken: false })

  it('lägger allt på en sida när det ryms', () => {
    const sidor = sidindela([inlagg(1), inlagg(2)], 1000)
    expect(sidor).toHaveLength(1)
  })

  it('delar ett långt pass på flera sidor', () => {
    const rader = Array.from({ length: 200 }, (_, n) => inlagg(n))
    const sidor = sidindela(rader, 700)
    expect(sidor.length).toBeGreaterThan(1)
    expect(sidor.flat()).toHaveLength(200)
    for (const sida of sidor) {
      const hojd = sida.reduce((s, r) => s + radhojd(r), 0)
      expect(hojd).toBeLessThanOrEqual(700)
    }
  })

  it('låter inte en rubrik bli ensam sist på en sida', () => {
    // 14 punkter per inlägg, 22 för rubriken: rubriken hamnar precis i kanten.
    const rader = [inlagg(1), inlagg(2), { typ: 'sektion', text: 'Anteckningar' }, inlagg(3)]
    const sidor = sidindela(rader, 50)
    const sist = sidor[0][sidor[0].length - 1]
    expect(sist.typ).not.toBe('sektion')
    expect(sidor[1][0]).toMatchObject({ typ: 'sektion' })
  })

  it('lämnar aldrig en signatur ensam överst på nästa sida', () => {
    // En signatur utan sitt inlägg ser ut som att rapporten tappat en rad.
    const rader = [inlagg(1), inlagg(2), { typ: 'signatur', text: 'ZÄEM', markning: '', accent: false }]
    const sidor = sidindela(rader, 30)
    expect(sidor[sidor.length - 1].map((r) => r.typ)).toEqual(['inlagg', 'signatur'])
  })

  it('ger alltid minst en sida', () => {
    expect(sidindela([], 700)).toEqual([[]])
  })
})

describe('byggRader', () => {
  it('tar med objekt, personal, inlägg och sammanfattning', () => {
    const rader = byggRader(data(), matBokstav)
    const texter = rader.map((r) => r.text || '').join('|')
    expect(texter).toContain('Clarion Draken Hotel')
    expect(texter).toContain('2026-08-17')
    expect(texter).toContain('Anteckningar')
    expect(texter).toContain('person nekades')      // singular vid exakt en
    expect(rader.some((r) => r.typ === 'personal' && r.sign === 'ZÄEM')).toBe(true)
  })

  it('utelämnar incidenttyper utan träffar', () => {
    const rader = byggRader(data({ stats: {} }), matBokstav)
    expect(rader.some((r) => r.typ === 'sektion' && r.text === 'Sammanfattning')).toBe(false)
  })

  it('behåller originalet överstruket och märker rättelsen', () => {
    // Samma invariant som i mejlet: inget tas bort ur en rapport.
    const rader = byggRader(data({
      entries: [
        rad({ id: 'a', meddelande: 'Fel rumsnummer.', ar_rattad: true }),
        rad({ id: 'b', tid: '23:20', meddelande: 'Rätt rumsnummer 412.', rattar_id: 'a' })
      ]
    }), matBokstav)

    const struket = rader.filter((r) => r.typ === 'inlagg' && r.struken)
    expect(struket.map((r) => r.text).join(' ')).toContain('Fel rumsnummer.')
    expect(rader.some((r) => r.typ === 'signatur' && r.markning === 'RÄTTAD')).toBe(true)
    expect(rader.some((r) => r.typ === 'signatur' && r.markning === 'RÄTTELSE')).toBe(true)
  })

  it('säger ifrån när passet är tomt i stället för att visa ingenting', () => {
    const rader = byggRader(data({ roster: [], entries: [], stats: {} }), matBokstav)
    const texter = rader.map((r) => r.text || '').join('|')
    expect(texter).toContain('Ingen personal registrerad')
    expect(texter).toContain('Inget skrevs i passet.')
  })
})

describe('filnamn', () => {
  it('namnger filen efter objekt och datum', () => {
    expect(filnamn(data())).toBe('Raptr Clarion Draken Hotel 2026-08-17.pdf')
  })

  it('rensar tecken som inte hör hemma i ett filnamn', () => {
    expect(filnamn(data({ objekt: { namn: 'Hotell/Bar: "Ess"' } })))
      .toBe('Raptr HotellBar Ess 2026-08-17.pdf')
  })
})

describe('renderaPdf', () => {
  it('ger en giltig PDF med rapportens innehåll', async () => {
    const bytes = await renderaPdf(data())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')

    const dok = await PDFDocument.load(bytes)
    expect(dok.getPageCount()).toBe(1)
    expect(dok.getTitle()).toContain('Clarion Draken Hotel')
  })

  it('kastar inte på emoji eller en 300 tecken lång rad', async () => {
    // Det är det här som annars tystar hela rapporten: ett enda tecken som
    // WinAnsi inte kan koda, skrivet kl 02:00.
    const bytes = await renderaPdf(data({
      entries: [
        rad({ id: 'a', meddelande: 'Allt lugnt 👍🏽 — gästen 😀 nöjd' }),
        rad({ id: 'b', meddelande: 'x'.repeat(300) })
      ]
    }))
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('växer till flera sidor när passet är långt', async () => {
    const entries = Array.from({ length: 120 }, (_, n) => rad({
      id: `i${n}`, tid: '02:00', meddelande: `Rond ${n}: allt lugnt i entrén och på plan 4.`
    }))
    const dok = await PDFDocument.load(await renderaPdf(data({ entries })))
    expect(dok.getPageCount()).toBeGreaterThan(1)
  })
})

describe('base64', () => {
  it('kodar bytes som Resend kan ta emot', () => {
    expect(base64(new TextEncoder().encode('Raptr'))).toBe('UmFwdHI=')
  })

  it('klarar en hel PDF utan att spränga anropsstacken', async () => {
    const kodad = base64(await renderaPdf(data()))
    expect(kodad).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(atob(kodad).slice(0, 5)).toBe('%PDF-')
  })
})
