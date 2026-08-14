import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { toMinutes, normalizeTid, sortKey, nowHHMM, localISO, todayISO, verksamhetsdatum } from './time.js'

// Passloggen är appens kärna och nattpass är normalfallet: ett pass startar
// 14:30 och slutar 03:00 nästa dygn. Testerna nedan låser fast att inlägg
// hamnar i rätt pass och i rätt ordning över midnatt.

describe('toMinutes', () => {
  it('läser vanliga tider', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('09:30')).toBe(570)
    expect(toMinutes('23:59')).toBe(1439)
  })

  it('tar starttiden vid intervall', () => {
    expect(toMinutes('20:45-21:30')).toBe(1245)
    expect(toMinutes('20:45–21:30')).toBe(1245) // en dash
    expect(toMinutes('20:45—21:30')).toBe(1245) // em dash
  })

  it('accepterar punkt som separator', () => {
    expect(toMinutes('21.05')).toBe(1265)
  })

  it('tolkar siffror utan separator som HMM respektive HHMM', () => {
    // "930" skrevs tidigare som timme 93 → sortnyckel 5580
    expect(toMinutes('930')).toBe(570)
    expect(toMinutes('2045')).toBe(1245)
  })

  it('returnerar null för ogiltig indata i stället för att tyst ge 0', () => {
    // Tyst 0 gjorde att inlägget hamnade FÖRST i rapporten
    expect(toMinutes('inget klockslag')).toBeNull()
    expect(toMinutes('')).toBeNull()
    expect(toMinutes(null)).toBeNull()
    expect(toMinutes(undefined)).toBeNull()
  })

  it('avvisar orimliga timmar och minuter', () => {
    expect(toMinutes('24:00')).toBeNull()
    expect(toMinutes('93:00')).toBeNull()
    expect(toMinutes('12:60')).toBeNull()
  })
})

describe('normalizeTid', () => {
  it('normaliserar till HH:MM', () => {
    expect(normalizeTid('930')).toBe('09:30')
    expect(normalizeTid('9:30')).toBe('09:30')
    expect(normalizeTid('21.05')).toBe('21:05')
  })

  it('behåller intervall', () => {
    expect(normalizeTid('2045-2130')).toBe('20:45-21:30')
    expect(normalizeTid('20:45 – 21:30')).toBe('20:45-21:30')
  })

  it('returnerar null för ogiltig indata', () => {
    expect(normalizeTid('cirka midnatt')).toBeNull()
    expect(normalizeTid('20:45-99:99')).toBeNull()
  })
})

describe('sortKey', () => {
  const passStart = '14:30' // nattpass 14:30–03:00

  it('sorterar kvällens inlägg i tidsordning', () => {
    expect(sortKey('20:15', passStart)).toBeLessThan(sortKey('21:10', passStart))
    expect(sortKey('21:10', passStart)).toBeLessThan(sortKey('23:50', passStart))
  })

  it('lägger inlägg efter midnatt sist på ett nattpass', () => {
    expect(sortKey('00:18', passStart)).toBeGreaterThan(sortKey('23:50', passStart))
    expect(sortKey('03:00', passStart)).toBeGreaterThan(sortKey('00:18', passStart))
  })

  it('lägger INTE tidiga morgoninlägg sist på ett dagpass', () => {
    // Tidigare hårdkodad gräns vid 06:00 sköt 05:30 till nästa dygn, så ett
    // dagpass 06:00–15:00 fick sitt första inlägg placerat allra sist.
    const dagpass = '06:00'
    expect(sortKey('05:30', dagpass)).toBeLessThan(sortKey('06:15', dagpass))
    expect(sortKey('06:15', dagpass)).toBeLessThan(sortKey('14:00', dagpass))
  })

  it('placerar inlägg relativt passets start, inte relativt midnatt', () => {
    expect(sortKey('14:30', passStart)).toBe(0)
    expect(sortKey('15:30', passStart)).toBe(60)
    expect(sortKey('03:00', passStart)).toBe(750) // 12 h 30 min efter start
  })

  it('faller tillbaka på minuter från midnatt när passets start är okänd', () => {
    expect(sortKey('21:10')).toBe(1270)
    expect(sortKey('00:18')).toBe(18)
  })

  it('sorterar ogiltiga tider sist i stället för först', () => {
    expect(sortKey('nonsens', passStart)).toBeGreaterThan(sortKey('03:00', passStart))
  })
})

describe('lokal tid kontra UTC', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('nowHHMM ger lokal tid', () => {
    // 21:30 UTC = 23:30 svensk sommartid
    vi.setSystemTime(new Date('2026-08-07T21:30:00Z'))
    expect(nowHHMM()).toBe('23:30')
  })

  it('localISO ger lokalt datum, inte UTC-datum', () => {
    // 22:15 UTC den 7:e = 00:15 lokalt den 8:e
    vi.setSystemTime(new Date('2026-08-07T22:15:00Z'))
    expect(localISO()).toBe('2026-08-08')
    // Det gamla todayISO() använde toISOString() och gav '2026-08-07' här,
    // medan nowHHMM() samtidigt sa 00:15 — passet bytte datum mitt i natten.
    expect(localISO()).not.toBe(new Date().toISOString().slice(0, 10))
  })

  it('todayISO följer lokal tid', () => {
    vi.setSystemTime(new Date('2026-08-07T22:15:00Z'))
    expect(todayISO()).toBe('2026-08-08')
  })
})

describe('verksamhetsdatum', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('räknar natten efter midnatt till föregående dygn', () => {
    // 00:18 lokal tid natten mot den 8:e hör till passet som startade den 7:e
    vi.setSystemTime(new Date('2026-08-07T22:18:00Z')) // = 00:18 lokalt 8 aug
    expect(verksamhetsdatum()).toBe('2026-08-07')
  })

  it('byter dygn först vid brytpunkten', () => {
    vi.setSystemTime(new Date('2026-08-08T02:59:00Z')) // = 04:59 lokalt
    expect(verksamhetsdatum()).toBe('2026-08-07')

    vi.setSystemTime(new Date('2026-08-08T03:01:00Z')) // = 05:01 lokalt
    expect(verksamhetsdatum()).toBe('2026-08-08')
  })

  it('går att ställa in brytpunkten per objekt', () => {
    vi.setSystemTime(new Date('2026-08-08T04:30:00Z')) // = 06:30 lokalt
    expect(verksamhetsdatum(new Date(), 5)).toBe('2026-08-08')
    expect(verksamhetsdatum(new Date(), 8)).toBe('2026-08-07')
  })

  it('lämnar dagtid orörd', () => {
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z')) // = 14:00 lokalt
    expect(verksamhetsdatum()).toBe('2026-08-07')
  })
})

describe('nattpasset från början till slut', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('håller ihop passet över midnatt', () => {
    // Värden skriver 23:55 …
    vi.setSystemTime(new Date('2026-08-07T21:55:00Z')) // 23:55 lokalt 7 aug
    const foreMidnatt = verksamhetsdatum()

    // … och 00:20, efter midnatt.
    vi.setSystemTime(new Date('2026-08-07T22:20:00Z')) // 00:20 lokalt 8 aug
    const efterMidnatt = verksamhetsdatum()

    // Samma pass — inte ett nytt, tomt pass.
    expect(efterMidnatt).toBe(foreMidnatt)
    expect(sortKey('00:20', '14:30')).toBeGreaterThan(sortKey('23:55', '14:30'))
  })
})
