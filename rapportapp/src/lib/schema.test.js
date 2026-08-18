import { describe, it, expect, beforeEach } from 'vitest'
import {
  listSchema, setSchemaRad, removeSchemaRad, setSchemaPersonal, removeSchemaPersonal,
  skapaPassFranSchema, passForObjektDatum, rosterForPass, VECKODAGAR
} from './api.js'
import { db } from './mockStore.js'
import { localISO } from './time.js'

beforeEach(() => {
  const schema = db.objektSchema.map((r) => ({ ...r }))
  const schemaPersonal = db.schemaPersonal.map((r) => ({ ...r }))
  const pass = db.pass.map((p) => ({ ...p }))
  const passPersonal = db.passPersonal.map((r) => ({ ...r }))
  const objekt = db.objekt.map((o) => ({ ...o }))
  return () => {
    db.objektSchema.splice(0, db.objektSchema.length, ...schema)
    db.schemaPersonal = schemaPersonal
    db.pass.splice(0, db.pass.length, ...pass)
    db.passPersonal.splice(0, db.passPersonal.length, ...passPersonal)
    db.objekt.splice(0, db.objekt.length, ...objekt)
  }
})

// Datum för nästa förekomst av en ISO-veckodag (1 = måndag), räknat från idag.
function nastaDag(veckodag) {
  const d = new Date()
  for (let n = 0; n < 8; n++) {
    const kandidat = new Date(d)
    kandidat.setDate(d.getDate() + n)
    const iso = kandidat.getDay() === 0 ? 7 : kandidat.getDay()
    if (iso === veckodag) return localISO(kandidat)
  }
  throw new Error('hittade ingen sådan veckodag')
}

describe('schemarader', () => {
  it('kräver en starttid — den styr både sortering och när loggen öppnar', async () => {
    await expect(setSchemaRad('o2', 1, { starttid: '' })).rejects.toThrow(/Starttiden måste anges/)
  })

  it('avvisar en tid som inte går att tolka i stället för att gissa', async () => {
    await expect(setSchemaRad('o2', 1, { starttid: 'kvällen' })).rejects.toThrow(/går inte att tolka/)
  })

  it('tillåter att sluttiden saknas — den fylls ibland i senare', async () => {
    const rad = await setSchemaRad('o2', 1, { starttid: '22:00' })
    expect(rad.sluttid).toBeNull()
  })

  it('avvisar en veckodag utanför 1–7', async () => {
    await expect(setSchemaRad('o2', 0, { starttid: '22:00' })).rejects.toThrow(/1–7/)
    await expect(setSchemaRad('o2', 8, { starttid: '22:00' })).rejects.toThrow(/1–7/)
  })

  it('ger en rad per veckodag och objekt, inte en till för varje sparning', async () => {
    await setSchemaRad('o2', 3, { starttid: '22:00' })
    await setSchemaRad('o2', 3, { starttid: '21:00', sluttid: '05:00' })

    const rader = await listSchema('o2')
    const onsdag = rader.filter((r) => r.veckodag === 3)
    expect(onsdag).toHaveLength(1)
    expect(onsdag[0].starttid).toBe('21:00')
    expect(onsdag[0].sluttid).toBe('05:00')
  })

  it('tar med standardbemanningen när schemat läses', async () => {
    const rader = await listSchema('o1')
    expect(rader.map((r) => r.veckodag)).toEqual([5, 6])
    expect(rader[0].personal.map((p) => p.initialer)).toContain('ZÄEM')
  })

  it('tar bort bemanningen med dagen, så inga rader blir kvar utan hem', async () => {
    const rad = (await listSchema('o1'))[0]
    await removeSchemaRad(rad.id)

    expect((await listSchema('o1')).some((r) => r.id === rad.id)).toBe(false)
    expect(db.schemaPersonal.some((sp) => sp.schema_id === rad.id)).toBe(false)
  })

  it('lägger till och tar bort en person i standardbemanningen', async () => {
    const rad = (await listSchema('o1'))[0]
    await setSchemaPersonal(rad.id, 'p2', { roll: 'Värd', tid_in: '18:00', tid_ut: '01:30' })

    let uppdaterad = (await listSchema('o1')).find((r) => r.id === rad.id)
    expect(uppdaterad.personal.find((p) => p.personal_id === 'p2')).toMatchObject({ tid_in: '18:00' })

    await removeSchemaPersonal(rad.id, 'p2')
    uppdaterad = (await listSchema('o1')).find((r) => r.id === rad.id)
    expect(uppdaterad.personal.some((p) => p.personal_id === 'p2')).toBe(false)
  })
})

describe('skapa pass ur schemat', () => {
  it('skapar passet med schemats tider och bemanning', async () => {
    const fredag = nastaDag(5)
    await skapaPassFranSchema(14)

    const p = await passForObjektDatum('o1', fredag)
    expect(p).toBeTruthy()
    expect(p.starttid).toBe('14:30')
    expect(p.sluttid).toBe('03:00')

    const roster = await rosterForPass(p.id)
    expect(roster.map((r) => r.initialer).sort()).toEqual(['MOBO', 'ZÄEM'])
  })

  it('räknar bara nya pass och rör inte dagar som redan är upplagda', async () => {
    const forsta = await skapaPassFranSchema(14)
    expect(forsta.skapade).toBeGreaterThan(0)

    const andra = await skapaPassFranSchema(14)
    expect(andra.skapade).toBe(0)
    expect(andra.fanns).toBe(forsta.skapade + forsta.fanns)
  })

  it('lämnar ett handpålagt pass i fred — avvikelsen är medveten', async () => {
    const fredag = nastaDag(5)
    db.pass.push({ id: 'handpalagt', objekt_id: 'o1', datum: fredag, starttid: '23:00', sluttid: '07:00', status: 'oppet' })

    await skapaPassFranSchema(14)

    const p = await passForObjektDatum('o1', fredag)
    expect(p.id).toBe('handpalagt')
    expect(p.starttid).toBe('23:00')
  })

  it('hoppar över pausade schemarader', async () => {
    const fredag = nastaDag(5)
    for (const rad of db.objektSchema) rad.aktiv = false

    const svar = await skapaPassFranSchema(14)

    expect(svar.skapade).toBe(0)
    expect(await passForObjektDatum('o1', fredag)).toBeFalsy()
  })

  it('hoppar över inaktiva objekt', async () => {
    const fredag = nastaDag(5)
    db.objekt.find((o) => o.id === 'o1').aktiv = false

    await skapaPassFranSchema(14)

    expect(await passForObjektDatum('o1', fredag)).toBeFalsy()
  })

  it('vägrar ett orimligt antal dagar i stället för att fylla databasen', async () => {
    await expect(skapaPassFranSchema(0)).rejects.toThrow(/mellan 1 och 90/)
    await expect(skapaPassFranSchema(365)).rejects.toThrow(/mellan 1 och 90/)
    await expect(skapaPassFranSchema('två veckor')).rejects.toThrow(/mellan 1 och 90/)
  })

  it('täcker exakt så många dagar som begärts', async () => {
    // En dag framåt kan som mest ge fredagens eller lördagens pass.
    const svar = await skapaPassFranSchema(1)
    expect(svar.skapade + svar.fanns).toBeLessThanOrEqual(1)
  })
})

describe('veckodagarna', () => {
  it('följer ISO, så måndag är 1 och söndag 7 — samma som databasen räknar', () => {
    expect(VECKODAGAR.map((d) => d.nr)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(VECKODAGAR[0].namn).toBe('Måndag')
    expect(VECKODAGAR[6].namn).toBe('Söndag')
  })
})
