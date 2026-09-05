import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ReportDetail from './ReportDetail.jsx'

const api = vi.hoisted(() => ({ report: vi.fn(), lockAndSend: vi.fn() }))

vi.mock('../../lib/api.js', async () => {
  const riktig = await vi.importActual('../../lib/api.js')
  return { ...api, INCIDENT_TYPES: riktig.INCIDENT_TYPES }
})

const OBJEKT = { id: 'o1', namn: 'Clarion Draken Hotel', rapportmottagare: ['drift@draken.se'] }
const PASS = { id: 'pass1', datum: '2026-08-17', starttid: '22:00', sluttid: '06:00', status: 'granskas' }

const rad = (extra = {}) => ({
  id: 'i1', tid: '23:15', meddelande: 'Nekar två minderåriga vid entrén.',
  signatur: 'ZÄEM', incident_typ: 'nekad_alder', ar_rattad: false, rattar_id: null, ...extra
})

const svar = (extra = {}) => ({
  objekt: OBJEKT, pass: PASS,
  roster: [{ personal_id: 'p1', initialer: 'ZÄEM', roll: 'Värd', tid_in: '22:00', tid_ut: '06:00' }],
  entries: [rad()],
  stats: { nekad_alder: 1 },
  ...extra
})

function visa() {
  return render(
    <MemoryRouter initialEntries={['/admin/pass/pass1']}>
      <Routes><Route path="/admin/pass/:passId" element={<ReportDetail />} /></Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  api.report.mockResolvedValue(svar())
  api.lockAndSend.mockResolvedValue({ ok: true, mottagare: ['drift@draken.se'], utskickat: true })
})

afterEach(() => vi.clearAllMocks())

describe('rapporten som kunden får', () => {
  it('visar ett rättat inlägg överstruket med rättelsen under', async () => {
    api.report.mockResolvedValue(svar({
      entries: [
        rad({ ar_rattad: true }),
        rad({ id: 'i2', rattar_id: 'i1', meddelande: 'Rättelse: en minderårig, inte två.' })
      ]
    }))
    visa()

    const original = (await screen.findByText('Nekar två minderåriga vid entrén.')).closest('.rrow')
    const rattelse = screen.getByText('Rättelse: en minderårig, inte två.').closest('.rrow')

    // Originalet raderas aldrig — det ska gå att se vad som först skrevs.
    expect(original.className).toContain('rattad')
    expect(within(original).getByText('Rättad')).toBeInTheDocument()
    expect(rattelse.className).toContain('rattelse')
    expect(within(rattelse).getByText('Rättelse')).toBeInTheDocument()
  })

  it('räknar rättelser för sig i sammanfattningen', async () => {
    api.report.mockResolvedValue(svar({
      entries: [rad({ ar_rattad: true }), rad({ id: 'i2', rattar_id: 'i1', meddelande: 'Rättelse.' })]
    }))
    visa()
    expect(await screen.findByText(/2 inlägg \(varav 1 rättelse\)/)).toBeInTheDocument()
  })

  it('nämner inga rättelser när det inte finns några', async () => {
    visa()
    expect(await screen.findByText(/1 inlägg/)).toBeInTheDocument()
    expect(screen.queryByText(/varav/)).not.toBeInTheDocument()
  })
})

describe('låsa rapporten', () => {
  it('går inte att låsa utan mottagare — då vet ingen vart den ska', async () => {
    api.report.mockResolvedValue(svar({ objekt: { ...OBJEKT, rapportmottagare: [] } }))
    visa()

    expect(await screen.findByRole('button', { name: /Lås och skicka/ })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/saknar mottagare/i)
  })

  it('frågar en gång till innan utskicket, eftersom det inte går att ångra', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.click(screen.getByRole('button', { name: /Lås och skicka rapporten/ }))

    const ruta = await screen.findByRole('dialog')
    expect(within(ruta).getByText(/går den inte att ändra/i)).toBeInTheDocument()
    expect(api.lockAndSend).not.toHaveBeenCalled()

    await anv.click(within(ruta).getByRole('button', { name: /Lås och skicka/ }))
    await waitFor(() => expect(api.lockAndSend).toHaveBeenCalledWith('pass1', { omskick: false }))
  })

  it('säger vem rapporten mejlats till när utskicket gått igenom', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.click(screen.getByRole('button', { name: /Lås och skicka rapporten/ }))
    await anv.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Lås och skicka/ }))

    expect(await screen.findByText(/Rapporten är skickad/i)).toBeInTheDocument()
    expect(screen.getByText(/Mejlad till drift@draken.se/)).toBeInTheDocument()
  })

  it('skiljer ett låst pass vars mejl fastnat från ett levererat', async () => {
    // status `last` betyder stängd logg men obekräftad leverans. Det ska synas
    // även efter en omladdning — orsaken kommer från databasen, inte från ett
    // React-state som försvinner när fliken stängs.
    api.report.mockResolvedValue(svar({
      pass: { ...PASS, status: 'last', utskick_fel: 'Resend svarade 403: domain not verified' }
    }))
    visa()

    expect(await screen.findByText(/Låst, men inte skickad/i)).toBeInTheDocument()
    expect(screen.getByText(/Kunden har inte fått rapporten/i)).toBeInTheDocument()
    expect(screen.getByText(/domain not verified/)).toBeInTheDocument()
    expect(screen.queryByText(/Mejlad till/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Försök skicka igen' })).toBeInTheDocument()
  })

  it('visar ett levererat pass som skickat', async () => {
    api.report.mockResolvedValue(svar({ pass: { ...PASS, status: 'skickat' } }))
    visa()

    expect(await screen.findByText(/Rapporten är skickad/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lås och skicka rapporten/ })).not.toBeInTheDocument()
  })

  it('kräver ett aktivt val för att skicka om — dubbelklick ska inte ge kunden två mejl', async () => {
    api.report.mockResolvedValue(svar({ pass: { ...PASS, status: 'skickat' } }))
    const anv = userEvent.setup()
    visa()

    await anv.click(await screen.findByRole('button', { name: /Skicka om|Försök skicka igen/ }))
    const ruta = await screen.findByRole('dialog')
    expect(within(ruta).getByText(/får kunden den två gånger/i)).toBeInTheDocument()
    expect(api.lockAndSend).not.toHaveBeenCalled()

    await anv.click(within(ruta).getByRole('button', { name: 'Skicka om' }))
    await waitFor(() => expect(api.lockAndSend).toHaveBeenCalledWith('pass1', { omskick: true }))
  })

  it('visar serverns besked när passet låstes men mejlet fastnade', async () => {
    const { ApiError } = await vi.importActual('../../lib/errors.js')
    api.lockAndSend.mockRejectedValue(new ApiError(
      'Passet är låst, men mejlet gick inte iväg. Välj Skicka om när felet är åtgärdat.',
      { kod: 'utskick' }
    ))
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.click(screen.getByRole('button', { name: /Lås och skicka rapporten/ }))
    await anv.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Lås och skicka/ }))

    expect(await screen.findByText(/mejlet gick inte iväg/i)).toBeInTheDocument()
  })
})
