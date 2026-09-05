import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ShiftLog from './ShiftLog.jsx'
import { nollstall } from '../lib/utkorg.js'

// Datalagret ersätts: testerna handlar om vad värden ser och kan göra, inte
// om hur raderna hämtas. api.js har egna tester.
const api = vi.hoisted(() => ({
  objectsForStaff: vi.fn(),
  aktivtPassForStaff: vi.fn(),
  passById: vi.fn(),
  entriesForPass: vi.fn(),
  addEntry: vi.fn()
}))

vi.mock('../lib/api.js', async () => {
  const riktig = await vi.importActual('../lib/api.js')
  return { ...api, INCIDENT_TYPES: riktig.INCIDENT_TYPES }
})

const STAFF = { id: 'p1', initialer: 'ZÄEM', roll: 'Värd' }
vi.mock('../state/sessionCtx.js', () => ({ useSession: () => ({ staff: STAFF }) }))

const OBJEKT = { id: 'o1', namn: 'Clarion Draken Hotel' }
const PASS = { id: 'pass1', objekt_id: 'o1', datum: '2026-08-17', starttid: '22:00', sluttid: '06:00', status: 'oppet' }

const inlagg = (extra = {}) => ({
  id: 'i1', pass_id: 'pass1', personal_id: 'p1', tid: '23:15',
  meddelande: 'Nekar två minderåriga vid entrén.', incident_typ: 'nekad_alder',
  signatur: 'ZÄEM', ar_rattad: false, rattar_id: null, ...extra
})

function online(varde) {
  Object.defineProperty(navigator, 'onLine', { value: varde, configurable: true })
}

function visa() {
  return render(
    <MemoryRouter initialEntries={['/objekt/o1']}>
      <Routes><Route path="/objekt/:objektId" element={<ShiftLog />} /></Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  nollstall()
  online(true)
  api.objectsForStaff.mockResolvedValue([OBJEKT])
  api.aktivtPassForStaff.mockResolvedValue({ pass: PASS, bemannad: true })
  api.passById.mockResolvedValue(PASS)
  api.entriesForPass.mockResolvedValue([inlagg()])
  api.addEntry.mockResolvedValue(inlagg({ id: 'i2' }))
})

afterEach(() => {
  vi.clearAllMocks()
  nollstall()
})

describe('vem som släpps in i passloggen', () => {
  it('säger till den som inte är kopplad till objektet', async () => {
    api.objectsForStaff.mockResolvedValue([])
    visa()
    expect(await screen.findByText(/inte behörighet till det här objektet/i)).toBeInTheDocument()
  })

  it('säger till när inget pass pågår, och skiljer det från behörighetsfel', async () => {
    api.aktivtPassForStaff.mockResolvedValue({ pass: null, bemannad: false })
    visa()
    expect(await screen.findByText(/Inget pass pågår just nu/i)).toBeInTheDocument()
    expect(screen.queryByText(/inte behörighet/i)).not.toBeInTheDocument()
  })

  it('släpper inte in den som är kopplad till objektet men inte bemannad på passet', async () => {
    api.aktivtPassForStaff.mockResolvedValue({ pass: PASS, bemannad: false })
    visa()

    expect(await screen.findByText(/inte bemannad på passet/i)).toBeInTheDocument()
    // Loggen får inte ens hämtas för den som inte får läsa den.
    expect(api.entriesForPass).not.toHaveBeenCalled()
  })

  it('visar loggen för den som är bemannad', async () => {
    visa()
    expect(await screen.findByText('Nekar två minderåriga vid entrén.')).toBeInTheDocument()
    expect(screen.getByLabelText('Inlägg')).toBeInTheDocument()
  })
})

describe('skriva i loggen', () => {
  it('sparar inlägget och rensar fältet först när det gått fram', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.type(screen.getByLabelText('Inlägg'), 'Rooftop stänger, 22 gäster kvar.')
    await anv.click(screen.getByLabelText('Spara inlägg'))

    await waitFor(() => expect(api.addEntry).toHaveBeenCalled())
    expect(api.addEntry.mock.calls[0][0]).toMatchObject({
      passId: 'pass1', personalId: 'p1', meddelande: 'Rooftop stänger, 22 gäster kvar.', rattarId: null
    })
    await waitFor(() => expect(screen.getByLabelText('Inlägg')).toHaveValue(''))
  })

  it('behåller texten när inlägget nekas, så värden slipper skriva om den', async () => {
    const { ApiError } = await vi.importActual('../lib/errors.js')
    api.addEntry.mockRejectedValue(new ApiError('Passet är låst och rapporten skickad.', { kod: 'last' }))
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.type(screen.getByLabelText('Inlägg'), 'Kommer inte fram.')
    await anv.click(screen.getByLabelText('Spara inlägg'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/låst/i)
    expect(screen.getByLabelText('Inlägg')).toHaveValue('Kommer inte fram.')
  })

  it('vägrar en tid som inte går att tolka i stället för att gissa', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.clear(screen.getByLabelText('Tid'))
    await anv.type(screen.getByLabelText('Tid'), 'i går kväll')
    await anv.type(screen.getByLabelText('Inlägg'), 'Något hände.')
    await anv.click(screen.getByLabelText('Spara inlägg'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/går inte att tolka/i)
    expect(api.addEntry).not.toHaveBeenCalled()
  })

  it('stänger skrivfältet när rapporten är låst', async () => {
    api.passById.mockResolvedValue({ ...PASS, status: 'skickat' })
    api.aktivtPassForStaff.mockResolvedValue({ pass: { ...PASS, status: 'skickat' }, bemannad: true })
    visa()

    expect(await screen.findByText(/Passet är låst och rapporten skickad/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Inlägg')).not.toBeInTheDocument()
  })
})

describe('rättelser', () => {
  it('förifyller rättelsen med originalets tid, text och tagg', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.click(screen.getByRole('button', { name: 'Rätta' }))

    expect(screen.getByLabelText('Tid')).toHaveValue('23:15')
    expect(screen.getByLabelText('Inlägg')).toHaveValue('Nekar två minderåriga vid entrén.')
    expect(screen.getByRole('button', { name: 'Nekad ålder/kod' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Originalet står kvar/i)).toBeInTheDocument()
  })

  it('skickar rättelsen med en pekare till originalet', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.click(screen.getByRole('button', { name: 'Rätta' }))
    await anv.clear(screen.getByLabelText('Inlägg'))
    await anv.type(screen.getByLabelText('Inlägg'), 'Rättelse: en minderårig, inte två.')
    await anv.click(screen.getByLabelText('Spara rättelse'))

    await waitFor(() => expect(api.addEntry).toHaveBeenCalled())
    expect(api.addEntry.mock.calls[0][0]).toMatchObject({
      rattarId: 'i1', meddelande: 'Rättelse: en minderårig, inte två.'
    })
  })

  it('går att avbryta utan att originalet ändras', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.click(screen.getByRole('button', { name: 'Rätta' }))
    await anv.click(screen.getByRole('button', { name: 'Avbryt' }))

    expect(screen.getByLabelText('Inlägg')).toHaveValue('')
    expect(screen.queryByText(/Originalet står kvar/i)).not.toBeInTheDocument()
    expect(api.addEntry).not.toHaveBeenCalled()
  })

  it('visar originalet överstruket med rättelsen under, och erbjuder ingen ny rättelse', async () => {
    api.entriesForPass.mockResolvedValue([
      inlagg({ ar_rattad: true }),
      inlagg({ id: 'i2', rattar_id: 'i1', meddelande: 'Rättelse: en minderårig, inte två.' })
    ])
    visa()

    const original = (await screen.findByText('Nekar två minderåriga vid entrén.')).closest('.entry')
    const rattelse = (await screen.findByText('Rättelse: en minderårig, inte två.')).closest('.entry')

    expect(original.className).toContain('rattad')
    expect(within(original).getByText('Rättad')).toBeInTheDocument()
    expect(rattelse.className).toContain('rattelse')
    expect(within(rattelse).getByText('Rättelse')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rätta' })).not.toBeInTheDocument()
  })
})

describe('utan nät', () => {
  it('köar inlägget i stället för att slänga texten', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    online(false)
    await anv.type(screen.getByLabelText('Inlägg'), 'Offline: hissen står mellan plan 2 och 3.')
    await anv.click(screen.getByLabelText('Spara inlägg'))

    expect(await screen.findByText('Väntar på nät')).toBeInTheDocument()
    expect(screen.getByText('Offline: hissen står mellan plan 2 och 3.')).toBeInTheDocument()
    expect(api.addEntry).not.toHaveBeenCalled()   // ingen server att fråga
    // Kön ligger kvar även om appen stängs.
    expect(JSON.parse(localStorage.getItem('rapportapp.utkorg.v1'))).toHaveLength(1)
    expect(screen.getByLabelText('Inlägg')).toHaveValue('')
  })

  it('köar INTE om ett inlägg som redan sparats när omhämtningen faller', async () => {
    // Buggen: omhämtningen låg i samma try som skrivningen. Tappades nätet
    // däremellan såg det ut som en misslyckad skrivning, inlägget köades om
    // med ett nytt id, och kunden fick det två gånger i rapporten.
    const { ApiError } = await vi.importActual('../lib/errors.js')
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    api.entriesForPass.mockRejectedValueOnce(
      new ApiError('Kunde inte hämta passloggen.', { orsak: { message: 'Failed to fetch' } })
    )
    await anv.type(screen.getByLabelText('Inlägg'), 'Rooftop stänger, 22 gäster kvar.')
    await anv.click(screen.getByLabelText('Spara inlägg'))

    await waitFor(() => expect(api.addEntry).toHaveBeenCalled())
    expect(await screen.findByText(/Inlägget sparades/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('rapportapp.utkorg.v1') || '[]')).toHaveLength(0)
    expect(screen.queryByText('Väntar på nät')).not.toBeInTheDocument()
  })

  it('skickar med ett id som databasen kan känna igen vid omskick', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.type(screen.getByLabelText('Inlägg'), 'Rond utförd.')
    await anv.click(screen.getByLabelText('Spara inlägg'))

    await waitFor(() => expect(api.addEntry).toHaveBeenCalled())
    expect(api.addEntry.mock.calls[0][0].id).toEqual(expect.any(String))
  })

  it('skickar kön när nätet kommer tillbaka', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    online(false)
    await anv.type(screen.getByLabelText('Inlägg'), 'Offline: eskorterar gäst från garaget.')
    await anv.click(screen.getByLabelText('Spara inlägg'))
    await screen.findByText('Väntar på nät')

    online(true)
    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(api.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({ meddelande: 'Offline: eskorterar gäst från garaget.' })
    ))
    await waitFor(() => expect(screen.queryByText('Väntar på nät')).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem('rapportapp.utkorg.v1'))).toHaveLength(0)
  })
})
