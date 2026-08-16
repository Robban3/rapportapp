import { describe, it, expect } from 'vitest'
import { toMinutes, normalizeTid, normalizeKlockslag, sortKey, passFonster, arPassAktivt } from './time.js'
import { openPassForObjekt, setPassTider, setRosterEntry, addEntry, entriesForPass, passForObjektDatum } from './api.js'

// Regressionstester för formatet databasen faktiskt svarar med.
//
// `pass.starttid` och `pass.sluttid` är `time`-kolumner, och PostgREST
// serialiserar dem som "14:30:00". Appen läste bara "HH:MM", så varje pass som
// hämtades ur en riktig Supabase blev otolkbart: passfönstret kollapsade till
// midnatt, nattpass stängde två timmar för tidigt och inläggen efter midnatt
// hamnade överst i kundens rapport. Testsviten missade det helt eftersom den
// bara kör mot mock-lagret, där tiderna aldrig passerar Postgres.

const PG = { datum: '2026-08-16', starttid: '14:30:00', sluttid: '03:00:00' }
const APP = { datum: '2026-08-16', starttid: '14:30', sluttid: '03:00' }

describe('tider från Postgres', () => {
  it('tolkar HH:MM:SS likvärdigt med HH:MM', () => {
    expect(toMinutes('14:30:00')).toBe(toMinutes('14:30'))
    expect(toMinutes('00:00:00')).toBe(0)
    expect(toMinutes('23:59:59')).toBe(1439)
    expect(normalizeTid('14:30:00')).toBe('14:30')
    expect(normalizeKlockslag('03:00:00')).toBe('03:00')
  })

  it('tar även mikrosekunder, som vissa drivrutiner lägger på', () => {
    expect(toMinutes('14:30:00.123456')).toBe(870)
  })

  it('ger samma passfönster oavsett format', () => {
    const fpg = passFonster(PG)
    const fapp = passFonster(APP)
    expect(fpg.start).toEqual(fapp.start)
    expect(fpg.slut).toEqual(fapp.slut)
    expect(fpg.overMidnatt).toBe(true)
    expect(fpg.oppetSlut).toBe(false)
  })

  it('håller nattpasset öppet kl 02:00 även med databasens format', () => {
    const kl0200 = new Date('2026-08-17T02:00:00')
    expect(arPassAktivt(APP, kl0200)).toBe(true)
    expect(arPassAktivt(PG, kl0200)).toBe(true)   // stängde 01:00 innan fixen
  })

  it('sorterar inläggen lika oavsett format på passets starttid', () => {
    const tider = ['22:10', '23:00', '00:40', '02:15']
    const ordna = (start) => [...tider].sort((a, b) => sortKey(a, start) - sortKey(b, start))
    expect(ordna('14:30:00')).toEqual(['22:10', '23:00', '00:40', '02:15'])
    expect(ordna('14:30:00')).toEqual(ordna('14:30'))
  })
})

describe('otolkbara tider tystas inte', () => {
  it('markerar passfönstret som ogiltigt i stället för att gissa midnatt', () => {
    const trasigt = { datum: '2026-08-16', starttid: 'i går kväll', sluttid: '03:00' }
    expect(passFonster(trasigt).giltig).toBe(false)
    expect(passFonster(APP).giltig).toBe(true)
  })

  it('håller grinden stängd för ett pass med otolkbara tider', () => {
    const trasigt = { datum: '2026-08-16', starttid: 'sent', sluttid: null }
    expect(arPassAktivt(trasigt, new Date('2026-08-16T12:00:00'))).toBe(false)
  })

  it('flyttar inte ett trasigt datum till den 1:a i månaden', () => {
    // `(dag || 1)` gjorde tidigare varje oläsbar dagdel tyst till en etta.
    for (const datum of ['', 'i morgon', '2026-08', '2026-8-16', '2026-08-16T00:00:00', undefined]) {
      expect(passFonster({ datum, starttid: '14:30', sluttid: '03:00' }).giltig).toBe(false)
    }
    // Och ett datum som inte finns rullar inte över till nästa månad.
    expect(passFonster({ datum: '2026-02-31', starttid: '14:30' }).giltig).toBe(false)
    expect(passFonster({ datum: '2026-08-16', starttid: '14:30' }).giltig).toBe(true)
  })

  it('kastar i stället för att stämpla klockan nu när starttiden är skräp', async () => {
    await expect(openPassForObjekt('o2', '2027-01-05', 'kl 8 på kvällen'))
      .rejects.toThrow(/går inte att tolka/)

    // Och kastar FÖRE insert, så inget halvfärdigt pass blir kvar.
    expect(await passForObjektDatum('o2', '2027-01-05')).toBeNull()
  })

  it('stämplar inte tyst klockan nu när ett inläggs tid är skräp', async () => {
    const pass = await openPassForObjekt('o2', '2027-01-07', '20:00')
    await setRosterEntry(pass.id, 'p1', { roll: 'Värd' })

    await expect(addEntry({ passId: pass.id, personalId: 'p1', tid: 'i går kväll', meddelande: 'Rond', passStartTid: '20:00' }))
      .rejects.toThrow(/går inte att tolka/)

    // Tom tid betyder däremot fortfarande "nu" — det är avsikten, inte ett fel.
    const nu = await addEntry({ passId: pass.id, personalId: 'p1', tid: '', meddelande: 'Rond', passStartTid: '20:00' })
    expect(nu.tid).toMatch(/^\d{2}:\d{2}$/)
  })

  it('avvisar intervall som passets tider men tillåter dem i inlägg', async () => {
    const pass = await openPassForObjekt('o2', '2027-01-06', '20:00')
    await expect(setPassTider(pass.id, { sluttid: '04:00-05:00' })).rejects.toThrow(/går inte att tolka/)
    await expect(setRosterEntry(pass.id, 'p1', { tid_in: '20:00-21:00' })).rejects.toThrow(/går inte att tolka/)

    // Inlägg får fortfarande spänna över ett intervall — det är en funktion.
    await setRosterEntry(pass.id, 'p1', { roll: 'Värd' })
    const sparat = await addEntry({ passId: pass.id, personalId: 'p1', tid: '20:45-21:30', meddelande: 'Eskort', passStartTid: '20:00' })
    expect(sparat.tid).toBe('20:45-21:30')
  })
})

describe('setPassTider rör bara det som skickas med', () => {
  it('behåller starttiden när bara sluttiden sätts', async () => {
    const pass = await openPassForObjekt('o2', '2027-02-01', '22:00')
    await setRosterEntry(pass.id, 'p1', { roll: 'Värd' })
    for (const t of ['22:10', '23:40', '00:30', '02:20']) {
      await addEntry({ passId: pass.id, personalId: 'p1', tid: t, meddelande: 'rond ' + t, passStartTid: pass.starttid })
    }

    const efter = await setPassTider(pass.id, { sluttid: '06:00' })
    expect(efter.starttid).toBe('22:00')
    expect(efter.sluttid).toBe('06:00')

    // Nollades starttiden hamnade inläggen efter midnatt överst i rapporten.
    expect((await entriesForPass(pass.id)).map((e) => e.tid)).toEqual(['22:10', '23:40', '00:30', '02:20'])
  })

  it('rensar sluttiden på tom sträng men vägrar rensa starttiden', async () => {
    const pass = await openPassForObjekt('o2', '2027-02-02', '22:00')
    await setPassTider(pass.id, { sluttid: '06:00' })

    expect((await setPassTider(pass.id, { sluttid: '' })).sluttid).toBeNull()
    await expect(setPassTider(pass.id, { starttid: '' })).rejects.toThrow(/måste ha en starttid/)
  })
})

describe('låst pass', () => {
  it('tar inte emot fler inlägg', async () => {
    const pass = await openPassForObjekt('o2', '2027-03-01', '20:00')
    await setRosterEntry(pass.id, 'p1', { roll: 'Värd' })
    await addEntry({ passId: pass.id, personalId: 'p1', tid: '20:10', meddelande: 'Start', passStartTid: '20:00' })

    const { lockAndSend } = await import('./api.js')
    await lockAndSend(pass.id, 'kund@example.se')

    await expect(addEntry({ passId: pass.id, personalId: 'p1', tid: '21:00', meddelande: 'Efterhandsnotering', passStartTid: '20:00' }))
      .rejects.toThrow(/låst/)
    expect(await entriesForPass(pass.id)).toHaveLength(1)
  })
})

describe('pass daterat i morgon', () => {
  it('syns under den tidiga toleransen strax före midnatt', async () => {
    const { aktivtPassForStaff } = await import('./api.js')
    const pass = await openPassForObjekt('o3', '2027-04-02', '00:30')
    await setPassTider(pass.id, { sluttid: '08:00' })
    await setRosterEntry(pass.id, 'p1', { roll: 'Värd' })

    // Kl 23:45 den 1:a ligger 00:30 den 2:a inom timmens tolerans.
    const strax = await aktivtPassForStaff('p1', 'o3', new Date('2027-04-01T23:45:00'))
    expect(strax.pass?.id).toBe(pass.id)
    expect(strax.bemannad).toBe(true)
  })
})
