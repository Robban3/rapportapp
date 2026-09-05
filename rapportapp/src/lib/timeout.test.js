import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { arNatverksfel } from './utkorg.js'
import { medTimeout } from './supabase.js'
import { ApiError } from './errors.js'

// Timeouten i supabase.js finns för att ett hängande anrop ska bli ett FEL som
// utkorgen känner igen. Går den kopplingen sönder fastnar appen på "Laddar…"
// i stället för att köa inlägget — precis det tillståndet som är omöjligt att
// felsöka via telefon kl 02:00.

describe('en timeout ska räknas som nätverksfel', () => {
  it('känner igen texten som medTimeout kastar', () => {
    const kastat = new TypeError('Network request failed: timeout')
    expect(arNatverksfel(kastat)).toBe(true)
  })

  it('känner igen den även när supabase-js paketerat om den', () => {
    const fel = new ApiError('Kunde inte spara inlägget.', {
      orsak: { message: 'TypeError: Network request failed: timeout' }
    })
    expect(arNatverksfel(fel)).toBe(true)
  })
})

describe('medTimeout', () => {
  let ursprunglig

  beforeEach(() => { ursprunglig = globalThis.fetch })
  afterEach(() => { globalThis.fetch = ursprunglig })

  it('bryter ett anrop som aldrig svarar', async () => {
    // Ett anrop som hänger för alltid — 3G i ett garage, eller en backend som
    // svarar men aldrig blir klar.
    globalThis.fetch = (_input, init) => new Promise((_klar, avbryt) => {
      init.signal.addEventListener('abort', () => {
        const fel = new Error('aborted')
        fel.name = 'AbortError'
        avbryt(fel)
      })
    })

    await expect(medTimeout('/nagot', {}, 10)).rejects.toThrow(/timeout/)
  })

  it('felet är sådant att utkorgen köar inlägget', async () => {
    globalThis.fetch = (_input, init) => new Promise((_klar, avbryt) => {
      init.signal.addEventListener('abort', () => {
        const fel = new Error('aborted')
        fel.name = 'AbortError'
        avbryt(fel)
      })
    })

    const fel = await medTimeout('/nagot', {}, 10).catch((f) => f)
    expect(arNatverksfel(fel)).toBe(true)
  })

  it('släpper igenom ett svar som hinner fram', async () => {
    globalThis.fetch = async () => new Response('ok', { status: 200 })
    await expect(medTimeout('/nagot', {}, 200)).resolves.toMatchObject({ status: 200 })
  })

  it('rör inte ett anrop som redan har en egen signal', async () => {
    // supabase-js avbryter ibland själv. Två controllers på samma anrop hade
    // gjort det oklart vem som bröt och varför.
    let sedd
    globalThis.fetch = async (_i, init) => { sedd = init.signal; return new Response('ok') }
    const egen = new AbortController()
    await medTimeout('/nagot', { signal: egen.signal }, 10)
    expect(sedd).toBe(egen.signal)
  })
})
