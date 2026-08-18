import { describe, it, expect, beforeEach } from 'vitest'
import { addEntry, entriesForPass, report } from './api.js'
import { db } from './mockStore.js'

// Passet är daterat sin startdag och pass1 är det färdiga demopasset med
// inlägg både före och efter midnatt — precis det fall en rättelse måste
// klara utan att hoppa i tidsordningen.
const PASS = 'pass1'
const START = '14:30'

beforeEach(() => {
  const inlagg = db.inlagg.map((i) => ({ ...i }))
  const status = db.pass.map((p) => p.status)
  return () => {
    db.inlagg.splice(0, db.inlagg.length, ...inlagg)
    db.pass.forEach((p, n) => { p.status = status[n] })
  }
})

const original = () => db.inlagg.find((i) => i.pass_id === PASS && i.tid === '18:45')

function skrivRattelse(over, extra = {}) {
  return addEntry({
    passId: PASS, personalId: 'p1', tid: over.tid,
    meddelande: 'Rättelse: eskorten gällde rum 1408, inte 1407.',
    passStartTid: START, rattarId: over.id, ...extra
  })
}

describe('rättelser i passloggen', () => {
  it('lägger rättelsen direkt efter sitt original och märker båda', async () => {
    const org = original()
    await skrivRattelse(org)

    const rader = await entriesForPass(PASS)
    const n = rader.findIndex((r) => r.id === org.id)

    expect(rader[n].ar_rattad).toBe(true)
    expect(rader[n + 1].rattar_id).toBe(org.id)
    expect(rader[n + 1].ar_rattad).toBe(false)
  })

  it('behåller originalet i rapporten i stället för att ersätta det', async () => {
    const fore = await entriesForPass(PASS)
    const org = original()
    await skrivRattelse(org)
    const efter = await entriesForPass(PASS)

    expect(efter).toHaveLength(fore.length + 1)
    expect(efter.find((r) => r.id === org.id)?.meddelande).toBe(org.meddelande)
  })

  it('rubbar inte tidsordningen även när rättelsen skrivs sist', async () => {
    // Originalet ligger 18:45, rättelsen skrivs efter 03:00-inlägget men
    // ska ändå hamna mitt i loggen — inte sist.
    const org = original()
    await skrivRattelse(org)
    const rader = await entriesForPass(PASS)

    expect(rader[rader.length - 1].rattar_id).toBeFalsy()
    expect(rader[rader.length - 1].tid).toBe('03:00')
    const nycklar = rader.map((r) => r.sortnyckel)
    expect(nycklar).toEqual([...nycklar].sort((a, b) => a - b))
  })

  it('flyttar incidenttaggen från originalet till rättelsen i statistiken', async () => {
    const fore = await report(PASS)
    const org = original()                     // taggad info_alkohol
    expect(org.incident_typ).toBe('info_alkohol')

    await skrivRattelse(org, { incidentTyp: 'nekad_alder' })
    const efter = await report(PASS)

    expect(efter.stats.info_alkohol).toBe(fore.stats.info_alkohol - 1)
    expect(efter.stats.nekad_alder).toBe(fore.stats.nekad_alder + 1)
  })

  it('räknar bort taggen helt när rättelsen är otaggad', async () => {
    const fore = await report(PASS)
    await skrivRattelse(original())            // ingen incidentTyp
    const efter = await report(PASS)

    expect(efter.stats.info_alkohol).toBe(fore.stats.info_alkohol - 1)
  })

  it('vägrar rätta samma inlägg två gånger', async () => {
    const org = original()
    await skrivRattelse(org)
    await expect(skrivRattelse(org)).rejects.toThrow(/redan rättat/)
  })

  it('vägrar rätta en rättelse', async () => {
    const rattelse = await skrivRattelse(original())
    await expect(skrivRattelse(rattelse)).rejects.toThrow(/går inte att rätta/)
  })

  it('vägrar peka på ett inlägg i ett annat pass', async () => {
    const annat = await addEntry({
      passId: 'pass2', personalId: 'p1', tid: '20:00',
      meddelande: 'Inlägg i ett annat pass.', passStartTid: '14:30'
    })
    await expect(skrivRattelse(annat)).rejects.toThrow(/annat pass/)
  })

  it('vägrar rätta i ett låst pass', async () => {
    const org = original()
    db.pass.find((p) => p.id === PASS).status = 'skickat'
    await expect(skrivRattelse(org)).rejects.toThrow(/låst/)
  })

  it('vägrar peka på ett inlägg som inte finns', async () => {
    await expect(skrivRattelse({ id: 'finns-inte', tid: '18:45' })).rejects.toThrow(/finns inte/)
  })
})
