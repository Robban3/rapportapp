import { describe, it, expect, beforeEach, vi } from 'vitest'

// Supabase Auth ersätts med en attrapp. Det som testas är vad appen skickar
// dit och hur den tolkar svaren — inte Supabases eget beteende.
const attrapp = vi.hoisted(() => ({
  auth: {
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
    updateUser: vi.fn(async () => ({ error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } }))
  },
  // Profilen hämtas via min_profil(), inte via ett filter på auth_user_id.
  // Kolumnrättigheterna på `personal` omfattar även WHERE-villkor, så filtret
  // nekas — det var det som låste ute alla från inloggningen.
  rpc: vi.fn(async () => ({ data: [{ id: 'p1', initialer: 'ZÄEM', roll: 'Värd', aktiv: true }], error: null }))
}))

vi.mock('./supabase.js', () => ({ hasSupabase: true, supabase: attrapp }))

const { begarAterstallning, settNyttLosenord } = await import('./api.js')

beforeEach(() => {
  attrapp.auth.resetPasswordForEmail.mockClear().mockResolvedValue({ error: null })
  attrapp.auth.getSession.mockClear().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
  attrapp.auth.updateUser.mockClear().mockResolvedValue({ error: null })
})

describe('begära återställning', () => {
  it('skickar adressen normaliserad, med en återvändande länk', async () => {
    await begarAterstallning('  ZAEM@Example.SE ')

    const [adress, val] = attrapp.auth.resetPasswordForEmail.mock.calls[0]
    expect(adress).toBe('zaem@example.se')
    expect(val.redirectTo).toMatch(/\/nytt-losenord$/)
  })

  it('avvisar något som inte är en adress innan anropet görs', async () => {
    await expect(begarAterstallning('inte en adress')).rejects.toThrow(/ser inte giltig ut/)
    expect(attrapp.auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('avslöjar inte om adressen finns — svaret är detsamma oavsett', async () => {
    const svar = await begarAterstallning('finns.inte@example.se')
    expect(svar).toEqual({ ok: true })
  })

  it('säger till när Supabase strypt antalet försök', async () => {
    attrapp.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'For security purposes, rate limit exceeded' } })
    await expect(begarAterstallning('zaem@example.se')).rejects.toThrow(/För många försök/)
  })

  it('läcker inte serverns felmeddelande vidare till användaren', async () => {
    attrapp.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'User not found in tenant 42' } })
    await expect(begarAterstallning('zaem@example.se')).rejects.toThrow(/Kunde inte skicka återställningen/)
  })
})

describe('sätta nytt lösenord', () => {
  it('kräver minst 8 tecken, och frågar inte servern om ett kortare', async () => {
    await expect(settNyttLosenord('kort')).rejects.toThrow(/minst 8 tecken/)
    expect(attrapp.auth.updateUser).not.toHaveBeenCalled()
  })

  it('vägrar utan giltig session — länken är använd eller för gammal', async () => {
    attrapp.auth.getSession.mockResolvedValue({ data: { session: null } })
    await expect(settNyttLosenord('ettlångtlösenord')).rejects.toThrow(/gått ut eller är redan använd/)
    expect(attrapp.auth.updateUser).not.toHaveBeenCalled()
  })

  it('byter lösenordet för den inloggade — aldrig för någon annan', async () => {
    await settNyttLosenord('ettlångtlösenord')
    // Anropet bär bara lösenordet. Ingen användare pekas ut från klienten:
    // sessionen från länken avgör vems konto som ändras.
    expect(attrapp.auth.updateUser).toHaveBeenCalledWith({ password: 'ettlångtlösenord' })
  })

  it('returnerar personalraden så bytet loggar in direkt', async () => {
    await expect(settNyttLosenord('ettlångtlösenord')).resolves.toMatchObject({ initialer: 'ZÄEM' })
  })

  it('förklarar när det nya lösenordet är samma som det gamla', async () => {
    attrapp.auth.updateUser.mockResolvedValue({ error: { message: 'New password should be different from the old password.' } })
    await expect(settNyttLosenord('ettlångtlösenord')).rejects.toThrow(/skilja sig från det gamla/)
  })
})
