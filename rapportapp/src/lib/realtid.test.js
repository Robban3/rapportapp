import { describe, it, expect, beforeEach, vi } from 'vitest'

// Supabase-klienten finns inte i testmiljön. Den ersätts med en attrapp som
// spelar in vad prenumerationen faktiskt beställer — filtren är det lätta att
// skriva fel, och ett fel filter ger en logg som aldrig uppdateras.
const attrapp = vi.hoisted(() => {
  const kanal = {
    lyssnare: [],
    on(typ, spec, cb) { this.lyssnare.push({ typ, spec, cb }); return this },
    subscribe(cb) { this.statusCb = cb; return this },
    statusCb: null
  }
  return {
    kanal,
    supabase: {
      kanalnamn: null,
      channel(namn) { attrapp.supabase.kanalnamn = namn; return kanal },
      removeChannel: vi.fn()
    }
  }
})

vi.mock('./supabase.js', () => ({ hasSupabase: true, supabase: attrapp.supabase }))

const { lyssnaPaPass } = await import('./realtid.js')

beforeEach(() => {
  attrapp.kanal.lyssnare = []
  attrapp.kanal.statusCb = null
  attrapp.supabase.removeChannel.mockClear()
})

describe('realtidsprenumerationen', () => {
  it('lyssnar på inlägg i just det här passet', () => {
    lyssnaPaPass('pass1', { onAndring: () => {} })

    const inlagg = attrapp.kanal.lyssnare.find((l) => l.spec.table === 'inlagg')
    expect(inlagg.spec.filter).toBe('pass_id=eq.pass1')
    expect(inlagg.spec.event).toBe('*')     // även rättelser och ändringar
    expect(inlagg.spec.schema).toBe('public')
  })

  it('lyssnar på passets status, så en låst rapport stänger skrivfältet direkt', () => {
    lyssnaPaPass('pass1', { onAndring: () => {} })

    const pass = attrapp.kanal.lyssnare.find((l) => l.spec.table === 'pass')
    expect(pass.spec.filter).toBe('id=eq.pass1')
  })

  it('säger till om att något ändrats — utan att låtsas veta vad', () => {
    const onAndring = vi.fn()
    lyssnaPaPass('pass1', { onAndring })

    attrapp.kanal.lyssnare.forEach((l) => l.cb({ new: { meddelande: 'något' } }))

    expect(onAndring).toHaveBeenCalledTimes(attrapp.kanal.lyssnare.length)
    // Ingen data skickas vidare: loggen hämtas om i stället.
    expect(onAndring.mock.calls.every((a) => a.length === 0)).toBe(true)
  })

  it('rapporterar bara SUBSCRIBED som uppe — allt annat ska falla tillbaka på pollning', () => {
    const onStatus = vi.fn()
    lyssnaPaPass('pass1', { onAndring: () => {}, onStatus })

    attrapp.kanal.statusCb('SUBSCRIBED')
    attrapp.kanal.statusCb('CHANNEL_ERROR')
    attrapp.kanal.statusCb('TIMED_OUT')
    attrapp.kanal.statusCb('CLOSED')

    expect(onStatus.mock.calls.map((a) => a[0])).toEqual([true, false, false, false])
  })

  it('stänger kanalen och släcker statusen när passloggen lämnas', () => {
    const onStatus = vi.fn()
    const avsluta = lyssnaPaPass('pass1', { onAndring: () => {}, onStatus })

    avsluta()

    expect(attrapp.supabase.removeChannel).toHaveBeenCalledWith(attrapp.kanal)
    expect(onStatus).toHaveBeenLastCalledWith(false)
  })

  it('ger en egen kanal per pass', () => {
    lyssnaPaPass('pass1', { onAndring: () => {} })
    expect(attrapp.supabase.kanalnamn).toBe('passlogg:pass1')
    lyssnaPaPass('pass2', { onAndring: () => {} })
    expect(attrapp.supabase.kanalnamn).toBe('passlogg:pass2')
  })

  it('gör ingenting utan pass-id', () => {
    const onStatus = vi.fn()
    const avsluta = lyssnaPaPass(null, { onAndring: () => {}, onStatus })
    expect(onStatus).toHaveBeenCalledWith(false)
    expect(() => avsluta()).not.toThrow()
  })
})
