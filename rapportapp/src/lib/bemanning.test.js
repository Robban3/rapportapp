import { describe, it, expect, beforeEach } from 'vitest'
import {
  passForStaff, objektStatusForStaff, aktivtPassForStaff, rosterForPass,
  setRosterEntry, removeRosterEntry, staffForObjekt, openPassForObjekt,
  passForObjektDatum, setPassTider, senasteBemannadePass, kopieraBemanning,
  addEntry, entriesForPass, report
} from './api.js'
import { db } from './mockStore.js'
import { passFonster, arPassAktivt } from './time.js'

// Bemanningen är det som avgör vem som ser en passlogg. Testerna nedan kör mot
// mock-datalagret (samma väg som demoläget) och låser fast de tre utfallen:
// inget pass igång, pass igång men obemannad, och bemannad.

// Demopasset är daterat sin startdag och kan därför ligga på gårdagens datum
// när klockan är strax efter midnatt. Läs det ur datan i stället för att räkna
// ut det på nytt — annars blir testerna instabila mellan 00:00 och 02:00.
const IDAG = db.pass.find((p) => p.id === 'pass2').datum
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

describe('objektStatusForStaff', () => {
  it('skiljer bemannad, obemannad och inget pass åt', async () => {
    // Demopasset på Draken pågår alltid; Grand Central har inget pass alls.
    expect(await objektStatusForStaff(ZAEM, [DRAKEN, GRAND]))
      .toEqual({ [DRAKEN]: 'bemannad', [GRAND]: 'inget_pass' })

    expect(await objektStatusForStaff(VARO, [DRAKEN, GRAND]))
      .toEqual({ [DRAKEN]: 'ej_bemannad', [GRAND]: 'inget_pass' })
  })

  it('säger "inget pass" när passet inte har börjat än', async () => {
    const pass = db.pass.find((p) => p.id === 'pass2')
    const fore = new Date(`${pass.datum}T00:05:00`)

    // Kl 00:05 på passets startdag har det ännu inte startat (det börjar
    // tidigast två timmar innan "nu" i seeden, aldrig vid midnatt).
    if (pass.starttid > '01:05') {
      expect((await objektStatusForStaff(ZAEM, [DRAKEN], fore))[DRAKEN]).toBe('inget_pass')
    }
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

describe('pass över midnatt', () => {
  // Ett pass är daterat sin STARTDAG. Ett pass 14:30–03:00 den 16:e slutar
  // alltså kl 03:00 den 17:e, men allt hör till den 16:e:s rapport.
  const kl = (iso) => new Date(iso)

  it('lägger sluttiden på nästa dygn när den inte ligger efter starttiden', () => {
    const f = passFonster({ datum: '2026-08-16', starttid: '14:30', sluttid: '03:00' })
    expect(f.overMidnatt).toBe(true)
    expect(f.start).toEqual(kl('2026-08-16T14:30:00'))
    expect(f.slut).toEqual(kl('2026-08-17T03:00:00'))
  })

  it('håller dagpass inom ett och samma dygn', () => {
    const f = passFonster({ datum: '2026-08-16', starttid: '08:00', sluttid: '16:00' })
    expect(f.overMidnatt).toBe(false)
    expect(f.slut).toEqual(kl('2026-08-16T16:00:00'))
  })

  it('räknar ett pass utan sluttid som öppet ett dygn', () => {
    const f = passFonster({ datum: '2026-08-16', starttid: '22:00', sluttid: null })
    expect(f.oppetSlut).toBe(true)
    expect(f.slut).toEqual(kl('2026-08-17T22:00:00'))
  })

  it('håller passet öppet hela natten — även efter den gamla brytpunkten kl 05', () => {
    const nattpass = { datum: '2026-08-16', starttid: '22:00', sluttid: '06:00' }

    expect(arPassAktivt(nattpass, kl('2026-08-16T22:30:00'))).toBe(true)
    expect(arPassAktivt(nattpass, kl('2026-08-17T00:10:00'))).toBe(true)
    expect(arPassAktivt(nattpass, kl('2026-08-17T02:00:00'))).toBe(true)
    // Det här var buggen: verksamhetsdatum() bytte dygn kl 05 och tog passet
    // ifrån en värd som jobbade till 06:00.
    expect(arPassAktivt(nattpass, kl('2026-08-17T05:30:00'))).toBe(true)
    expect(arPassAktivt(nattpass, kl('2026-08-17T08:00:00'))).toBe(false)
  })

  it('släpper in den som kommer tidigt och den som skriver klart strax efter', () => {
    const p = { datum: '2026-08-16', starttid: '14:30', sluttid: '03:00' }
    expect(arPassAktivt(p, kl('2026-08-16T13:45:00'))).toBe(true)  // 45 min tidigt
    expect(arPassAktivt(p, kl('2026-08-16T12:00:00'))).toBe(false) // 2,5 tim tidigt
    expect(arPassAktivt(p, kl('2026-08-17T03:20:00'))).toBe(true)  // sista inlägget
    expect(arPassAktivt(p, kl('2026-08-17T05:00:00'))).toBe(false)
  })

  it('ger värden gårdagens pass när klockan passerat midnatt', async () => {
    const pass = await openPassForObjekt(GRAND, '2026-10-10', '22:00')
    await setPassTider(pass.id, { starttid: '22:00', sluttid: '06:00' })
    await setRosterEntry(pass.id, ZAEM, { roll: 'Värd' })

    const efterMidnatt = await aktivtPassForStaff(ZAEM, GRAND, kl('2026-10-11T02:30:00'))
    expect(efterMidnatt.pass?.id).toBe(pass.id)
    expect(efterMidnatt.pass.datum).toBe('2026-10-10')   // startdagen, inte den 11:e
    expect(efterMidnatt.bemannad).toBe(true)

    // Långt efter sluttiden är passet över.
    expect((await aktivtPassForStaff(ZAEM, GRAND, kl('2026-10-11T12:00:00'))).pass).toBeNull()
  })

  it('inlägg efter midnatt hamnar sist i passet, inte först', async () => {
    const pass = await openPassForObjekt(GRAND, '2026-10-12', '22:00')
    await setRosterEntry(pass.id, ZAEM, { roll: 'Värd' })

    for (const tid of ['02:15', '23:00', '00:40', '22:10']) {
      await addEntry({ passId: pass.id, personalId: ZAEM, tid, meddelande: `Rond ${tid}`, passStartTid: pass.starttid })
    }

    expect((await entriesForPass(pass.id)).map((e) => e.tid)).toEqual(['22:10', '23:00', '00:40', '02:15'])
  })
})

describe('kopiera bemanning', () => {
  it('hämtar senaste passet som faktiskt hade bemanning', async () => {
    const tomt = await openPassForObjekt(GRAND, '2026-11-01', '20:00')
    const bemannat = await openPassForObjekt(GRAND, '2026-11-02', '20:00')
    await setRosterEntry(bemannat.id, ZAEM, { roll: 'Värd', tid_in: '20:00', tid_ut: '04:00' })

    const senaste = await senasteBemannadePass(GRAND, '2026-11-03')
    expect(senaste.pass.id).toBe(bemannat.id)
    expect(senaste.pass.id).not.toBe(tomt.id)
  })

  it('kopierar roller och tider utan att dubbla den som redan står på passet', async () => {
    const igar = await openPassForObjekt(GRAND, '2026-11-10', '20:00')
    await setRosterEntry(igar.id, ZAEM, { roll: 'Värd', tid_in: '20:00', tid_ut: '04:00' })
    await setRosterEntry(igar.id, MOBO, { roll: 'Ordningsvakt', tid_in: '22:00', tid_ut: '04:00' })

    const idag = await openPassForObjekt(GRAND, '2026-11-11', '20:00')
    await setRosterEntry(idag.id, ZAEM, { roll: 'Värd', tid_in: '19:00', tid_ut: '03:00' })

    const { lagda, hoppade } = await kopieraBemanning(igar.id, idag.id)
    expect({ lagda, hoppade }).toEqual({ lagda: 1, hoppade: 1 })

    const roster = await rosterForPass(idag.id)
    expect(roster).toHaveLength(2)
    // ZÄEM:s egna tider skrivs INTE över av gårdagens.
    expect(roster.find((r) => r.personal_id === ZAEM)).toMatchObject({ tid_in: '19:00' })
    expect(roster.find((r) => r.personal_id === MOBO)).toMatchObject({ roll: 'Ordningsvakt', tid_in: '22:00' })
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
