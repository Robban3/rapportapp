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
  api.lockAndSend.mockResolvedValue({ utskickat: false })
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

    expect(await screen.findByRole('button', { name: /Lås rapporten/ })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/saknar mottagare/i)
  })

  it('frågar en gång till innan låsningen, eftersom den inte går att ångra', async () => {
    const anv = userEvent.setup()
    visa()
    await screen.findByText('Nekar två minderåriga vid entrén.')

    await anv.click(screen.getByRole('button', { name: 'Lås rapporten' }))

    const ruta = await screen.findByRole('dialog')
    expect(within(ruta).getByText(/går rapporten inte att ändra/i)).toBeInTheDocument()
    expect(api.lockAndSend).not.toHaveBeenCalled()

    await anv.click(within(ruta).getByRole('button', { name: 'Lås rapporten' }))
    await waitFor(() => expect(api.lockAndSend).toHaveBeenCalledWith('pass1', ['drift@draken.se']))
  })

  it('påstår inte att något mejlats — utskicket sker manuellt tills automatiken finns', async () => {
    api.report.mockResolvedValue(svar({ pass: { ...PASS, status: 'skickat' } }))
    visa()

    expect(await screen.findByText(/Rapporten är låst/i)).toBeInTheDocument()
    expect(screen.getByText(/sker manuellt/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lås rapporten/ })).not.toBeInTheDocument()
  })
})
