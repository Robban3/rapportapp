import { describe, it, expect, beforeEach } from 'vitest'
import { signIn, addStaff, listStaff } from './api.js'
import { db } from './mockStore.js'

// Demoläget har ingen autentisering — e-posten pekar ut vem du är. Testerna
// låser fast formen på API:t så att UI:t beter sig likadant i båda lägena,
// och att personalregistret inte längre kan innehålla en läsbar PIN.

beforeEach(() => {
  const snapshot = db.personal.map((p) => ({ ...p }))
  return () => { db.personal.splice(0, db.personal.length, ...snapshot) }
})

describe('signIn i demoläge', () => {
  it('släpper in på e-post och struntar i lösenordet', async () => {
    const p = await signIn('zaem@example.se', 'vad som helst')
    expect(p).toMatchObject({ initialer: 'ZÄEM', roll: 'Värd' })
  })

  it('bryr sig inte om versaler eller blanksteg', async () => {
    expect(await signIn('  ZAEM@Example.SE  ', 'x')).toMatchObject({ initialer: 'ZÄEM' })
  })

  it('ger null för okänd adress', async () => {
    expect(await signIn('ingen@example.se', 'x')).toBeNull()
  })

  it('lämnar aldrig ut något lösenord eller någon kod', async () => {
    const p = await signIn('admin@example.se', 'x')
    expect(p).not.toHaveProperty('kod')
    expect(p).not.toHaveProperty('losenord')
    expect(Object.keys(p).sort()).toEqual(['aktiv', 'epost', 'id', 'initialer', 'namn', 'roll'])
  })
})

describe('addStaff', () => {
  it('kräver e-post i stället för PIN', async () => {
    await expect(addStaff({ namn: 'Nina', initialer: 'NINA', roll: 'Värd', epost: '' }))
      .rejects.toThrow(/e-post måste fyllas i/i)
  })

  it('avvisar en adress som inte ser ut som e-post', async () => {
    await expect(addStaff({ namn: 'Nina', initialer: 'NINA', roll: 'Värd', epost: 'nina' }))
      .rejects.toThrow(/giltig ut/)
  })

  it('normaliserar adressen och avvisar dubbletter', async () => {
    const skapad = await addStaff({ namn: 'Nina', initialer: 'NINA', roll: 'Värd', epost: '  Nina@Example.SE ' })
    expect(skapad.epost).toBe('nina@example.se')

    await expect(addStaff({ namn: 'Annan', initialer: 'ANNA', roll: 'Värd', epost: 'nina@example.se' }))
      .rejects.toThrow(/används redan/)
  })

  it('den nya personen går att logga in som', async () => {
    await addStaff({ namn: 'Nina', initialer: 'NINA', roll: 'Ordningsvakt', epost: 'nina@example.se' })
    expect(await signIn('nina@example.se', 'x')).toMatchObject({ initialer: 'NINA' })
    expect((await listStaff()).some((p) => p.epost === 'nina@example.se')).toBe(true)
  })
})
