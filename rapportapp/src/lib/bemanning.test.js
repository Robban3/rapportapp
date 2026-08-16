import { describe, it, expect, beforeEach } from 'vitest'
import {
  passForStaff, rosteredObjektIds, rosterForPass, setRosterEntry, removeRosterEntry,
  staffForObjekt, openPassForObjekt, passForObjektDatum, setPassTider,
  addEntry, entriesForPass, report
} from './api.js'
import { db } from './mockStore.js'
import { verksamhetsdatum } from './time.js'

// Bemanningen är det som avgör vem som ser en passlogg. Testerna nedan kör mot
// mock-datalagret (samma väg som demoläget) och låser fast de tre utfallen:
// inget pass upplagt, upplagt men obemannad, och bemannad.

const IDAG = verksamhetsdatum()
const DRAKEN = 'o1'
const GRAND = 'o2'
const ZAEM = 'p1'   // bemannad på dagens pass
const VARO = 'p2'   // kopplad till o1 och o3, INTE bemannad idag
const MOBO = 'p4'   // bemannad på dagens pass

// Mock-datan lever i modulminnet, så varje test måste återställa det den rör.
let passSnapshot
let rosterSnapshot
let inlaggSnapshot

beforeEach(() => {
  passSnapshot = db.pass.map((p) => ({ ...p }))
  rosterSnapshot = db.passPersonal.map((r) => ({ ...r }))
  inlaggSnapshot = db.inlagg.map((i) => ({ ...i }))

  return () => {
    db.pass.splice(0, db.pass.length, ...passSnapshot)
    db.passPersonal.splice(0, db.passPersonal.length, ...rosterSnapshot)
    db.inlagg.splice(0, db.inlagg.length, ...inlaggSnapshot)
  }
})

describe('passForStaff', () => {
  it('ger passet till den som är bemannad', async () => {
    const { pass, bemannad } = await passForStaff(ZAEM, DRAKEN, IDAG)
    expect(pass).not.toBeNull()
    expect(bemannad).toBe(true)
  })

  it('håller isär obemannad från saknat pass', async () => {
    // VARO är kopplad till objektet men står inte på dagens pass.
    const obemannad = await passForStaff(VARO, DRAKEN, IDAG)
    expect(obemannad.pass).not.toBeNull()
    expect(obemannad.bemannad).toBe(false)

    // Grand Central har inget pass upplagt alls.
    const utanPass = await passForStaff(ZAEM, GRAND, IDAG)
    expect(utanPass.pass).toBeNull()
    expect(utanPass.bemannad).toBe(false)
  })

  it('skapar aldrig ett pass som sidoeffekt', async () => {
    const innan = db.pass.length
    await passForStaff(ZAEM, GRAND, IDAG)
    expect(db.pass.length).toBe(innan)
  })

  it('är bunden till datumet, inte bara objektet', async () => {
    // ZÄEM står på passet 2026-08-07, men det säger inget om andra dagar.
    expect((await passForStaff(ZAEM, DRAKEN, '2026-08-07')).bemannad).toBe(true)
    expect((await passForStaff(ZAEM, DRAKEN, '2026-08-08')).pass).toBeNull()
  })
})

describe('rosteredObjektIds', () => {
  it('listar bara objekt där personen är bemannad det datumet', async () => {
    expect(await rosteredObjektIds(ZAEM, IDAG)).toEqual([DRAKEN])
    expect(await rosteredObjektIds(MOBO, IDAG)).toEqual([DRAKEN])
    expect(await rosteredObjektIds(VARO, IDAG)).toEqual([])
  })
})

describe('bemanning från adminpanelen', () => {
  it('ger åtkomst först när personen lagts till på passet', async () => {
    const { pass } = await passForStaff(VARO, DRAKEN, IDAG)

    expect((await passForStaff(VARO, DRAKEN, IDAG)).bemannad).toBe(false)
    await setRosterEntry(pass.id, VARO, { roll: 'Värd', tid_in: '18:00', tid_ut: '01:30' })
    expect((await passForStaff(VARO, DRAKEN, IDAG)).bemannad).toBe(true)

    await removeRosterEntry(pass.id, VARO)
    expect((await passForStaff(VARO, DRAKEN, IDAG)).bemannad).toBe(false)
  })

  it('uppdaterar i stället för att dubblera en person som redan står på passet', async () => {
    const { pass } = await passForStaff(ZAEM, DRAKEN, IDAG)

    await setRosterEntry(pass.id, ZAEM, { roll: 'Värd', tid_in: '15:00', tid_ut: '23:00' })
    const roster = await rosterForPass(pass.id)

    expect(roster.filter((r) => r.personal_id === ZAEM)).toHaveLength(1)
    expect(roster.find((r) => r.personal_id === ZAEM)).toMatchObject({ tid_in: '15:00', tid_ut: '23:00' })
  })

  it('normaliserar tider och avvisar dem som inte går att tolka', async () => {
    const { pass } = await passForStaff(ZAEM, DRAKEN, IDAG)

    const sparad = await setRosterEntry(pass.id, VARO, { roll: 'Värd', tid_in: '1800' })
    expect(sparad.tid_in).toBe('18:00')
    expect(sparad.tid_ut).toBeNull()

    await expect(setRosterEntry(pass.id, VARO, { tid_in: 'i går kväll' })).rejects.toThrow(/går inte att tolka/)
  })

  it('erbjuder bara personal som är kopplad till objektet', async () => {
    const kopplade = (await staffForObjekt(DRAKEN)).map((p) => p.id)
    expect(kopplade).toContain(ZAEM)
    expect(kopplade).toContain(VARO)

    // Grand Central har bara admin kopplad i seed-datan.
    expect((await staffForObjekt(GRAND)).map((p) => p.id)).not.toContain(ZAEM)
  })
})

describe('openPassForObjekt', () => {
  it('skapar passet med angiven starttid i stället för klockan nu', async () => {
    const p = await openPassForObjekt(GRAND, '2026-09-01', '14:30')
    expect(p.starttid).toBe('14:30')
    expect(p.datum).toBe('2026-09-01')
    expect(await passForObjektDatum(GRAND, '2026-09-01')).toMatchObject({ id: p.id })
  })

  it('returnerar det befintliga passet i stället för att skapa ett andra', async () => {
    const forst = await openPassForObjekt(GRAND, '2026-09-02', '12:00')
    const igen = await openPassForObjekt(GRAND, '2026-09-02', '20:00')
    expect(igen.id).toBe(forst.id)
    expect(igen.starttid).toBe('12:00')
  })
})

describe('setPassTider', () => {
  it('sorterar om inläggen när starttiden rättas', async () => {
    const pass = await openPassForObjekt(GRAND, '2026-09-03', '20:00')
    await setRosterEntry(pass.id, ZAEM, { roll: 'Värd' })

    // Skrivna mot fel starttid: 02:00 hör till nattens slut, inte dess början.
    await addEntry({ passId: pass.id, personalId: ZAEM, tid: '02:00', meddelande: 'Yttre rond', passStartTid: pass.starttid })
    await addEntry({ passId: pass.id, personalId: ZAEM, tid: '22:00', meddelande: 'Ronderar entrén', passStartTid: pass.starttid })

    expect((await entriesForPass(pass.id)).map((e) => e.tid)).toEqual(['22:00', '02:00'])

    // Rättas starttiden till 01:00 blir 02:00 tidigt i passet och 22:00 sent.
    await setPassTider(pass.id, { starttid: '01:00', sluttid: '09:00' })
    expect((await entriesForPass(pass.id)).map((e) => e.tid)).toEqual(['02:00', '22:00'])
  })

  it('avvisar en sluttid som inte går att tolka', async () => {
    const pass = await openPassForObjekt(GRAND, '2026-09-04', '20:00')
    await expect(setPassTider(pass.id, { starttid: '20:00', sluttid: '25:99' })).rejects.toThrow(/går inte att tolka/)
  })
})

describe('rapporten', () => {
  it('speglar bemanningen admin satt', async () => {
    const { pass } = await passForStaff(ZAEM, DRAKEN, IDAG)
    await setRosterEntry(pass.id, VARO, { roll: 'Värd', tid_in: '18:00', tid_ut: '01:30' })

    const r = await report(pass.id)
    expect(r.roster.map((x) => x.initialer).sort()).toEqual(['MOBO', 'VARO', 'ZÄEM'])
  })
})
