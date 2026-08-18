import { describe, it, expect, beforeEach } from 'vitest'
import { listObjects, addObject, updateObject, setObjectAktiv, objectsForStaff } from './api.js'
import { db } from './mockStore.js'

beforeEach(() => {
  const snapshot = db.objekt.map((o) => ({ ...o, rapportmottagare: [...(o.rapportmottagare || [])] }))
  return () => { db.objekt.splice(0, db.objekt.length, ...snapshot) }
})

const GRUND = { namn: 'Nytt Hotell', kod: 'nytt', rapportmottagare: ['Drift@Nytt.SE'] }

describe('rapportmottagare', () => {
  it('normaliserar adresser och tar bort tomma rader', async () => {
    const o = await addObject({ ...GRUND, rapportmottagare: ['  Drift@Nytt.SE ', '', '   ', 'reception@nytt.se'] })
    expect(o.rapportmottagare).toEqual(['drift@nytt.se', 'reception@nytt.se'])
  })

  it('fäller ihop dubbletter så ingen får rapporten två gånger', async () => {
    const o = await addObject({ ...GRUND, rapportmottagare: ['drift@nytt.se', 'DRIFT@nytt.se', ' drift@nytt.se '] })
    expect(o.rapportmottagare).toEqual(['drift@nytt.se'])
  })

  it('avvisar en adress som inte ser ut som e-post', async () => {
    await expect(addObject({ ...GRUND, rapportmottagare: ['drift@nytt.se', 'inte en adress'] }))
      .rejects.toThrow(/ser inte ut som en e-postadress/)
  })

  it('tillåter objekt helt utan mottagare', async () => {
    const o = await addObject({ ...GRUND, rapportmottagare: [] })
    expect(o.rapportmottagare).toEqual([])
  })
})

describe('objektfält', () => {
  it('versaliserar koden och kräver ett namn', async () => {
    expect((await addObject(GRUND)).kod).toBe('NYTT')
    await expect(addObject({ ...GRUND, namn: '   ' })).rejects.toThrow(/måste ha ett namn/)
  })

  it('avvisar dubblerad objektkod, även vid redigering', async () => {
    await addObject(GRUND)
    await expect(addObject({ ...GRUND, namn: 'Annat' })).rejects.toThrow(/används redan/)

    const draken = (await listObjects()).find((o) => o.kod === 'DRAKEN')
    await expect(updateObject(draken.id, { ...draken, kod: 'NYTT' })).rejects.toThrow(/används redan/)
  })

  it('tolkar standardtiderna och avvisar skräp', async () => {
    const o = await addObject({ ...GRUND, standard_starttid: '2200', standard_sluttid: '06:00' })
    expect(o.standard_starttid).toBe('22:00')
    expect(o.standard_sluttid).toBe('06:00')

    await expect(addObject({ ...GRUND, kod: 'X2', standard_starttid: 'i kväll' }))
      .rejects.toThrow(/går inte att tolka/)
  })

  it('sparar tomma textfält som null i stället för tomma strängar', async () => {
    const o = await addObject({ ...GRUND, kontaktperson: '  ', instruktioner: '' })
    expect(o.kontaktperson).toBeNull()
    expect(o.instruktioner).toBeNull()
  })
})

describe('inaktivering', () => {
  it('döljer objektet i listorna men behåller det', async () => {
    const draken = (await listObjects()).find((o) => o.kod === 'DRAKEN')
    await setObjectAktiv(draken.id, false)

    expect((await listObjects()).some((o) => o.id === draken.id)).toBe(false)
    expect((await listObjects({ inklInaktiva: true })).some((o) => o.id === draken.id)).toBe(true)
  })

  it('tar bort objektet ur värdens lista utan att radera något', async () => {
    const draken = (await listObjects()).find((o) => o.kod === 'DRAKEN')
    expect((await objectsForStaff('p1')).some((o) => o.id === draken.id)).toBe(true)

    await setObjectAktiv(draken.id, false)
    expect((await objectsForStaff('p1')).some((o) => o.id === draken.id)).toBe(false)

    // Objektet finns kvar och går att aktivera igen.
    await setObjectAktiv(draken.id, true)
    expect((await objectsForStaff('p1')).some((o) => o.id === draken.id)).toBe(true)
  })
})
