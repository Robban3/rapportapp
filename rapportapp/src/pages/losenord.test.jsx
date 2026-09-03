import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Aterstall from './Aterstall.jsx'
import NyttLosenord from './NyttLosenord.jsx'

const api = vi.hoisted(() => ({ begarAterstallning: vi.fn(), settNyttLosenord: vi.fn() }))
const sb = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } }))
  }
}))
const sess = vi.hoisted(() => ({ setStaff: vi.fn() }))

vi.mock('../lib/api.js', () => api)
vi.mock('../lib/supabase.js', () => ({ hasSupabase: true, supabase: sb }))
vi.mock('../state/sessionCtx.js', () => ({ useSession: () => sess }))

function visa(Sida, sokvag = '/') {
  return render(
    <MemoryRouter initialEntries={[sokvag]}>
      <Routes>
        <Route path="/" element={<Sida />} />
        <Route path="/login" element={<div>inloggningssidan</div>} />
        <Route path="/aterstall" element={<div>begär ny länk-sidan</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  api.begarAterstallning.mockResolvedValue({ ok: true })
  api.settNyttLosenord.mockResolvedValue({ id: 'p1', initialer: 'ZÄEM' })
  sb.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
})

afterEach(() => vi.clearAllMocks())

describe('begära återställning', () => {
  it('bekräftar utan att avslöja om adressen finns', async () => {
    const anv = userEvent.setup()
    visa(Aterstall)

    await anv.type(screen.getByLabelText('E-post'), 'zaem@example.se')
    await anv.click(screen.getByRole('button', { name: /Skicka/ }))

    expect(await screen.findByText('Kolla mejlen')).toBeInTheDocument()
    // Formuleringen är villkorad — "finns adressen hos oss" — och säger
    // alltså inget om huruvida kontot existerar.
    expect(screen.getByText(/Finns/)).toHaveTextContent(/hos oss/)
    expect(screen.queryByText(/hittades inte|finns inte/i)).not.toBeInTheDocument()
  })

  it('visar felet när utskicket strypts', async () => {
    const { ApiError } = await vi.importActual('../lib/errors.js')
    api.begarAterstallning.mockRejectedValue(
      new ApiError('För många försök. Vänta en stund och försök igen.', { kod: 'aterstallning' })
    )
    const anv = userEvent.setup()
    visa(Aterstall)

    await anv.type(screen.getByLabelText('E-post'), 'zaem@example.se')
    await anv.click(screen.getByRole('button', { name: /Skicka/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('För många försök. Vänta en stund och försök igen.')
    expect(screen.queryByText('Kolla mejlen')).not.toBeInTheDocument()
  })
})

describe('sätta nytt lösenord', () => {
  it('säger att länken inte gäller när ingen session kom med den', async () => {
    sb.auth.getSession.mockResolvedValue({ data: { session: null } })
    visa(NyttLosenord)

    expect(await screen.findByText('Länken gäller inte', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByLabelText('Nytt lösenord')).not.toBeInTheDocument()
  })

  it('visar formuläret när länken gett en session', async () => {
    visa(NyttLosenord)
    expect(await screen.findByLabelText('Nytt lösenord')).toBeInTheDocument()
  })

  it('stoppar två olika lösenord innan något skickas', async () => {
    const anv = userEvent.setup()
    visa(NyttLosenord)
    await screen.findByLabelText('Nytt lösenord')

    await anv.type(screen.getByLabelText('Nytt lösenord'), 'ettlångtlösenord')
    await anv.type(screen.getByLabelText('Upprepa lösenordet'), 'ettannatlösenord')
    await anv.click(screen.getByRole('button', { name: /Spara/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/inte lika/)
    expect(api.settNyttLosenord).not.toHaveBeenCalled()
  })

  it('loggar in direkt efter bytet i stället för att be om lösenordet igen', async () => {
    const anv = userEvent.setup()
    visa(NyttLosenord)
    await screen.findByLabelText('Nytt lösenord')

    await anv.type(screen.getByLabelText('Nytt lösenord'), 'ettlångtlösenord')
    await anv.type(screen.getByLabelText('Upprepa lösenordet'), 'ettlångtlösenord')
    await anv.click(screen.getByRole('button', { name: /Spara/ }))

    await waitFor(() => expect(api.settNyttLosenord).toHaveBeenCalledWith('ettlångtlösenord'))
    await waitFor(() => expect(sess.setStaff).toHaveBeenCalledWith({ id: 'p1', initialer: 'ZÄEM' }))
  })

  it('säger till när kontot saknar personalrad, trots att lösenordet bytts', async () => {
    api.settNyttLosenord.mockResolvedValue(null)
    const anv = userEvent.setup()
    visa(NyttLosenord)
    await screen.findByLabelText('Nytt lösenord')

    await anv.type(screen.getByLabelText('Nytt lösenord'), 'ettlångtlösenord')
    await anv.type(screen.getByLabelText('Upprepa lösenordet'), 'ettlångtlösenord')
    await anv.click(screen.getByRole('button', { name: /Spara/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/inte kopplat till någon personal/)
    expect(sess.setStaff).not.toHaveBeenCalled()
  })
})
