import { describe, it, expect, vi, afterEach } from 'vitest'
import { tidIZon, rollFor, arPublicerat, gruppera, ROLLER }
  from '../../../supabase/functions/planday-synk/normalisera.ts'
import { ROLLER as ROLLER_APP } from './roller.js'

// Normaliseringen bor i Edge Function-mappen — Deno bundlar bara sin egen mapp
// — men testas härifrån. Det som avgör vem som kommer åt en passlogg ska inte
// vara det enda i kedjan som ingen kört.

const skift = (extra = {}) => ({
  id: 901, departmentId: 7, employeeId: 11, positionId: 3,
  date: '2026-09-11', timeZone: 'Europe/Stockholm',
  startDateTime: '2026-09-11T20:00:00Z',   // 22:00 svensk sommartid
  endDateTime: '2026-09-12T04:00:00Z',     // 06:00 svensk sommartid
  status: 'Assigned', ...extra
})

const positioner = new Map([[3, 'Värd'], [4, 'Ordningsvakt'], [5, 'Reception kväll']])
const anstallda = new Map([
  [11, { epost: 'zaem@example.se', namn: 'Zäem' }],
  [22, { epost: 'pesa@example.se', namn: 'Pesa' }]
])

afterEach(() => vi.restoreAllMocks())

describe('tidIZon', () => {
  it('ger väggklockan i skiftets tidszon, inte i UTC', () => {
    // Utan konverteringen blir 22:00–06:00 svensk tid till 20:00–04:00 i
    // databasen, och passfönstret som släpper in värden hamnar två timmar fel.
    expect(tidIZon('2026-09-11T20:00:00Z', 'Europe/Stockholm')).toBe('22:00')
    expect(tidIZon('2026-09-12T04:00:00Z', 'Europe/Stockholm')).toBe('06:00')
  })

  it('följer sommar- och vintertid', () => {
    expect(tidIZon('2026-09-11T20:00:00Z', 'Europe/Stockholm')).toBe('22:00') // CEST, +2
    expect(tidIZon('2026-12-11T20:00:00Z', 'Europe/Stockholm')).toBe('21:00') // CET,  +1
  })

  it('faller tillbaka på svensk tid vid okänd tidszon i stället för att kasta', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(tidIZon('2026-09-11T20:00:00Z', 'Mars/Olympus')).toBe('22:00')
    expect(console.warn).toHaveBeenCalled()
  })

  it('ger null för tom eller otolkbar tid', () => {
    expect(tidIZon(null)).toBeNull()
    expect(tidIZon('')).toBeNull()
    expect(tidIZon('inte ett datum')).toBeNull()
  })
})

describe('rollFor', () => {
  it('släpper igenom Raptrs egna roller, oavsett skiftläge', () => {
    expect(rollFor('Värd')).toBe('Värd')
    expect(rollFor('ordningsvakt')).toBe('Ordningsvakt')
    expect(rollFor('  Garderob  ')).toBe('Garderob')
  })

  it('lämnar rollen tom för ett fritt positionsnamn ur Planday', () => {
    // Ett positionsnamn som "Reception kväll" ska inte hamna rakt i rapporten
    // kunden får.
    expect(rollFor('Reception kväll')).toBeNull()
    expect(rollFor('')).toBeNull()
    expect(rollFor(null)).toBeNull()
  })

  it('gör aldrig någon till Admin via en Planday-position', () => {
    // Admin är en behörighet i Raptr, inte en position på ett pass.
    expect(rollFor('Admin')).toBeNull()
    expect(ROLLER).not.toContain('Admin')
  })

  it('håller rollistan i synk med appens', () => {
    // Edge Functions bundlar bara sin egen mapp, så listan finns i två
    // exemplar. Glider de isär får en Planday-position en roll som Raptr inte
    // känner igen, eller tvärtom.
    expect(ROLLER).toEqual(ROLLER_APP)
  })
})

describe('arPublicerat', () => {
  it('släpper inte igenom utkast', () => {
    expect(arPublicerat({ id: 1, departmentId: 7, status: 'Draft' })).toBe(false)
  })

  it('släpper igenom alla lägen där passet faktiskt ligger ute', () => {
    for (const status of ['Open', 'Assigned', 'Approved', 'OnDuty', 'ForSale',
                          'PendingSwapAcceptance', 'PendingApproval']) {
      expect(arPublicerat({ id: 1, departmentId: 7, status })).toBe(true)
    }
  })
})

describe('gruppera', () => {
  it('gör femton skift samma dygn till ETT pass med femton rader bemanning', () => {
    const femton = Array.from({ length: 15 }, (_, n) =>
      skift({ id: 900 + n, employeeId: 500 + n }))
    const per = gruppera(femton, { positioner, anstallda })

    expect(per.get(7)).toHaveLength(1)
    expect(per.get(7)[0].bemanning).toHaveLength(15)
  })

  it('tar tidigaste start och senaste slut som passets tider', () => {
    // En ordningsvakt som börjar 20:00 ska inte flytta passets start när
    // värden börjat 14:30.
    const per = gruppera([
      skift({ id: 1, employeeId: 11, startDateTime: '2026-09-11T12:30:00Z', endDateTime: '2026-09-11T21:30:00Z' }),
      skift({ id: 2, employeeId: 22, startDateTime: '2026-09-11T18:00:00Z', endDateTime: '2026-09-12T01:00:00Z' })
    ], { positioner, anstallda })

    expect(per.get(7)[0]).toMatchObject({ starttid: '14:30', sluttid: '03:00' })
  })

  it('daterar passet med Plandays date, även när skiftet går över midnatt', () => {
    // Skiftet slutar den 12:e men hör till den 11:e:s rapport. Plandays `date`
    // är redan definierad som startdagen, så ingen egen uträkning behövs.
    const per = gruppera([skift()], { positioner, anstallda })
    expect(per.get(7)[0].datum).toBe('2026-09-11')
  })

  it('utelämnar utkast helt', () => {
    const per = gruppera([
      skift({ id: 1, status: 'Draft' }),
      skift({ id: 2, date: '2026-09-12' })
    ], { positioner, anstallda })

    expect(per.get(7)).toHaveLength(1)
    expect(per.get(7)[0].datum).toBe('2026-09-12')
  })

  it('lägger upp passet även när ingen sökt det än', () => {
    // Ett Open-skift saknar employeeId. Passet ska ändå finnas med rätt tider,
    // så admin ser vilka kvällar som står obemannade.
    const per = gruppera([skift({ employeeId: null, status: 'Open' })], { positioner, anstallda })

    expect(per.get(7)[0]).toMatchObject({ starttid: '22:00', sluttid: '06:00' })
    expect(per.get(7)[0].bemanning).toEqual([])
  })

  it('bär med e-post och namn så SQL kan matcha personen', () => {
    const rad = gruppera([skift()], { positioner, anstallda }).get(7)[0].bemanning[0]
    expect(rad).toMatchObject({
      planday_shift_id: 901, planday_employee_id: 11,
      epost: 'zaem@example.se', namn: 'Zäem', roll: 'Värd',
      tid_in: '22:00', tid_ut: '06:00'
    })
  })

  it('tappar inte en anställd som saknas i personallistan', () => {
    // Utan e-post kan SQL inte matcha, men raden ska ändå med — då hamnar
    // personen i planday_omatchad i stället för att tyst falla bort.
    const rad = gruppera([skift({ employeeId: 77 })], { positioner, anstallda }).get(7)[0].bemanning[0]
    expect(rad).toMatchObject({ planday_employee_id: 77, epost: null, namn: null })
  })

  it('håller isär objekt och sorterar dagarna', () => {
    const per = gruppera([
      skift({ id: 1, departmentId: 7, date: '2026-09-12' }),
      skift({ id: 2, departmentId: 7, date: '2026-09-11' }),
      skift({ id: 3, departmentId: 9, date: '2026-09-11' })
    ], { positioner, anstallda })

    expect([...per.keys()].sort()).toEqual([7, 9])
    expect(per.get(7).map((p) => p.datum)).toEqual(['2026-09-11', '2026-09-12'])
    expect(per.get(9)).toHaveLength(1)
  })

  it('hoppar över skift utan department eller datum i stället för att kasta', () => {
    const per = gruppera([
      skift({ id: 1, departmentId: null }),
      skift({ id: 2, date: null }),
      skift({ id: 3 })
    ], { positioner, anstallda })

    expect(per.get(7)).toHaveLength(1)
    expect(per.get(7)[0].bemanning.map((b) => b.planday_shift_id)).toEqual([3])
  })

  it('ger en tom karta för en tom hämtning', () => {
    expect(gruppera([]).size).toBe(0)
  })
})
