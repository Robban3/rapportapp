import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  koFor, antalIKo, laggIKo, taBortFranKo, forsokIgen, flusha, arNatverksfel, felmarkerade, nollstall
} from './utkorg.js'
import { ApiError } from './errors.js'
import { addEntry, entriesForPass } from './api.js'
import { db } from './mockStore.js'

const POST = {
  passId: 'pass1', personalId: 'p1', tid: '23:15',
  meddelande: 'Nekar två minderåriga vid entrén.', incidentTyp: 'nekad_alder',
  passStartTid: '14:30', rattarId: null
}

function online(varde) {
  Object.defineProperty(navigator, 'onLine', { value: varde, configurable: true })
}

beforeEach(() => {
  nollstall()
  online(true)
  return () => nollstall()
})

const natfel = () => new ApiError('Kunde inte spara inlägget.', {
  orsak: { message: 'TypeError: Failed to fetch' }
})

describe('utkorgen', () => {
  it('överlever att appen stängs — kön ligger i localStorage', () => {
    laggIKo(POST)
    expect(JSON.parse(localStorage.getItem('rapportapp.utkorg.v1'))).toHaveLength(1)
  })

  it('håller isär personer på samma telefon', () => {
    laggIKo(POST)
    laggIKo({ ...POST, personalId: 'p4', meddelande: 'Yttre rond utan anmärkning.' })

    expect(koFor('p1', 'pass1')).toHaveLength(1)
    expect(koFor('p4', 'pass1')[0].meddelande).toBe('Yttre rond utan anmärkning.')
  })

  it('håller isär pass', () => {
    laggIKo(POST)
    laggIKo({ ...POST, passId: 'pass2' })
    expect(koFor('p1', 'pass1')).toHaveLength(1)
    expect(antalIKo('p1')).toBe(2)
  })

  it('ger varje inlägg ett eget id som följer med till servern', async () => {
    const a = laggIKo(POST)
    const b = laggIKo(POST)
    expect(a.id).not.toBe(b.id)

    const skickade = []
    await flusha('p1', async (rad) => { skickade.push(rad.id) })
    expect(skickade).toEqual([a.id, b.id])
  })

  it('skickar i den ordning inläggen skrevs', async () => {
    laggIKo({ ...POST, meddelande: 'Först' })
    laggIKo({ ...POST, meddelande: 'Sedan' })
    laggIKo({ ...POST, meddelande: 'Sist' })

    const skickade = []
    const svar = await flusha('p1', async (rad) => { skickade.push(rad.meddelande) })

    expect(skickade).toEqual(['Först', 'Sedan', 'Sist'])
    expect(svar.sparade).toBe(3)
    expect(antalIKo('p1')).toBe(0)
  })

  it('behåller inlägget i kön när nätet fortfarande är borta', async () => {
    laggIKo(POST)
    const svar = await flusha('p1', async () => { throw natfel() })

    expect(svar.sparade).toBe(0)
    expect(svar.kvar).toBe(1)
    expect(koFor('p1', 'pass1')[0].fel).toBeNull()   // inget att visa: det är bara nätet
  })

  it('stoppar flushen vid nätverksfel i stället för att kasta resten mot en död server', async () => {
    laggIKo({ ...POST, meddelande: 'Först' })
    laggIKo({ ...POST, meddelande: 'Sedan' })

    let forsok = 0
    await flusha('p1', async () => { forsok++; throw natfel() })

    expect(forsok).toBe(1)
    expect(antalIKo('p1')).toBe(2)
  })

  it('försöker inte skicka alls när enheten är offline', async () => {
    laggIKo(POST)
    online(false)
    const skicka = vi.fn()

    const svar = await flusha('p1', skicka)

    expect(skicka).not.toHaveBeenCalled()
    expect(svar.kvar).toBe(1)
  })

  it('markerar ett nekat inlägg i stället för att försöka i evighet', async () => {
    laggIKo(POST)
    const svar = await flusha('p1', async () => {
      throw new ApiError('Passet är låst och rapporten skickad.', { kod: 'last' })
    })

    expect(svar.nyaFel).toHaveLength(1)
    expect(koFor('p1', 'pass1')[0].fel).toMatch(/låst/)

    // Ett markerat inlägg tas inte med i nästa flush — det blir inte rätt av
    // att skickas om, och ska inte hindra inlägg efter det i kön.
    const skicka = vi.fn()
    await flusha('p1', skicka)
    expect(skicka).not.toHaveBeenCalled()
  })

  it('släpper igenom resten av kön även om ett inlägg nekas', async () => {
    laggIKo({ ...POST, meddelande: 'Nekas' })
    laggIKo({ ...POST, meddelande: 'Går fram' })

    const skickade = []
    await flusha('p1', async (rad) => {
      if (rad.meddelande === 'Nekas') throw new ApiError('Nekad.', { kod: 'last' })
      skickade.push(rad.meddelande)
    })

    expect(skickade).toEqual(['Går fram'])
    expect(antalIKo('p1')).toBe(1)
  })

  it('tar med ett markerat inlägg igen efter Försök igen', async () => {
    const rad = laggIKo(POST)
    await flusha('p1', async () => { throw new ApiError('Nekad.', { kod: 'last' }) })

    forsokIgen(rad.id)
    const svar = await flusha('p1', async () => {})

    expect(svar.sparade).toBe(1)
    expect(antalIKo('p1')).toBe(0)
  })

  it('går att slänga ett inlägg som aldrig kommer fram', () => {
    const rad = laggIKo(POST)
    taBortFranKo(rad.id)
    expect(antalIKo('p1')).toBe(0)
  })
})

describe('inlägg som nekats', () => {
  it('behåller ett medskickat id, så ett omskick inte blir en dubblett', () => {
    // Tappas nätet mellan skrivning och omhämtning köas inlägget om trots att
    // det redan är sparat. Behålls id:t krockar omskicket med primärnyckeln i
    // stället för att bli en andra rad i kundens rapport.
    const rad = laggIKo({ ...POST, id: 'redan-sparat' })
    expect(rad.id).toBe('redan-sparat')
  })

  it('syns oavsett vilket pass man står i', async () => {
    laggIKo({ ...POST, passId: 'pass1', meddelande: 'Från gårdagens pass' })
    await flusha('p1', async () => { throw new ApiError('Passet är låst.', { kod: 'last' }) })

    // Passloggen visar bara sitt eget pass. Utan den här vyn försvann inlägget
    // ur allas synfält så fort värden öppnade ett annat objekt.
    expect(koFor('p1', 'pass2')).toHaveLength(0)
    expect(felmarkerade('p1').map((k) => k.meddelande)).toEqual(['Från gårdagens pass'])
  })

  it('listar bara sådant som faktiskt nekats, inte det som väntar på nät', async () => {
    laggIKo({ ...POST, meddelande: 'Väntar bara' })
    online(false)
    await flusha('p1', async () => {})

    expect(felmarkerade('p1')).toHaveLength(0)
  })

  it('håller isär personer på samma telefon', async () => {
    laggIKo({ ...POST, personalId: 'p4', meddelande: 'Någon annans' })
    await flusha('p4', async () => { throw new ApiError('Nekad.', { kod: 'last' }) })

    expect(felmarkerade('p1')).toHaveLength(0)
    expect(felmarkerade('p4')).toHaveLength(1)
  })
})

describe('vad som räknas som nätverksfel', () => {
  it('köar ett tappat anrop', () => {
    expect(arNatverksfel(natfel())).toBe(true)
    expect(arNatverksfel(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('köar INTE ett nekat eller ogiltigt inlägg', () => {
    expect(arNatverksfel(new ApiError('Låst.', { kod: 'last' }))).toBe(false)
    expect(arNatverksfel(new ApiError('Ogiltig tid.', { kod: 'ogiltig_tid' }))).toBe(false)
    // RLS-nekande: servern svarade, inlägget blir inte rätt av ett omskick.
    expect(arNatverksfel(new ApiError('Nekad.', { kod: '42501' }))).toBe(false)
  })

  it('tolkar ett kodlöst fel som nätet när enheten är offline', () => {
    online(false)
    expect(arNatverksfel(new ApiError('Kunde inte spara inlägget.'))).toBe(true)
    online(true)
    expect(arNatverksfel(new ApiError('Kunde inte spara inlägget.'))).toBe(false)
  })
})

// Poängen med att id:t sätts på telefonen: skickas samma inlägg två gånger —
// första svaret kom aldrig fram — ska det inte bli två rader i rapporten.
describe('samma inlägg skickat två gånger', () => {
  beforeEach(() => {
    const inlagg = db.inlagg.map((i) => ({ ...i }))
    return () => { db.inlagg.splice(0, db.inlagg.length, ...inlagg) }
  })

  it('ger en rad, inte två', async () => {
    const rad = laggIKo({ ...POST, passId: 'pass1' })
    const gemensamt = {
      id: rad.id, passId: 'pass1', personalId: 'p1', tid: '23:15',
      meddelande: 'Dubbelskickat inlägg.', passStartTid: '14:30'
    }

    const fore = (await entriesForPass('pass1')).length
    const a = await addEntry(gemensamt)
    const b = await addEntry(gemensamt)
    const efter = await entriesForPass('pass1')

    expect(a.id).toBe(b.id)
    expect(efter).toHaveLength(fore + 1)
  })
})
