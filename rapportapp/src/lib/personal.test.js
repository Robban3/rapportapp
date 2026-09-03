import { describe, it, expect, beforeEach } from 'vitest'
import { setStaffAktiv, listStaff, objectsForStaff, staffForObjekt } from './api.js'
import { db } from './mockStore.js'

beforeEach(() => {
  const personal = db.personal.map((p) => ({ ...p }))
  return () => { db.personal.splice(0, db.personal.length, ...personal) }
})

const hamta = async (id) => (await listStaff()).find((p) => p.id === id)

describe('stänga av personal', () => {
  it('sätter aktiv till false utan att radera raden', async () => {
    await setStaffAktiv('p1', false)

    const person = await hamta('p1')
    expect(person.aktiv).toBe(false)
    // Raden måste finnas kvar: gamla inlägg är signerade med den, och en
    // rapport som tappar sin signatur är inget underlag.
    expect(person.namn).toBe('Zäem')
  })

  it('tar bort personen ur objektets bemanningsbara personal', async () => {
    expect((await staffForObjekt('o1')).map((p) => p.id)).toContain('p1')

    await setStaffAktiv('p1', false)

    expect((await staffForObjekt('o1')).map((p) => p.id)).not.toContain('p1')
  })

  it('går att ångra', async () => {
    await setStaffAktiv('p1', false)
    await setStaffAktiv('p1', true)

    expect((await hamta('p1')).aktiv).toBe(true)
    expect((await staffForObjekt('o1')).map((p) => p.id)).toContain('p1')
  })

  it('vägrar stänga av den sista aktiva administratören', async () => {
    // p5 är enda admin i demodatan. Utan spärren låser man ut sig ur
    // adminpanelen och måste in i Supabase-panelen för att komma tillbaka.
    await expect(setStaffAktiv('p5', false)).rejects.toThrow(/minst en aktiv administratör/)
    expect((await hamta('p5')).aktiv).toBe(true)
  })

  it('släpper igenom när det finns en admin till', async () => {
    db.personal.find((p) => p.id === 'p2').roll = 'Admin'

    await setStaffAktiv('p5', false)

    expect((await hamta('p5')).aktiv).toBe(false)
  })

  it('säger till när personen inte finns', async () => {
    await expect(setStaffAktiv('finns-inte', false)).rejects.toThrow(/finns inte/)
  })

  it('rör inte den avstängdas objektkopplingar — de gäller igen vid aktivering', async () => {
    const fore = await objectsForStaff('p1')
    await setStaffAktiv('p1', false)
    await setStaffAktiv('p1', true)

    expect((await objectsForStaff('p1')).map((o) => o.id)).toEqual(fore.map((o) => o.id))
  })
})
