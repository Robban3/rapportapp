import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signIn } from '../lib/api.js'
import { useSession } from '../state/session.jsx'
import { felText } from '../lib/errors.js'

// Koder får vara 4–8 tecken. Adminpanelen tillåter redan upp till 8, men
// inloggningen kapade till 4 och skickade automatiskt — längre koder gick
// därför aldrig att logga in med.
const MIN_LANGD = 4
const MAX_LANGD = 8

export default function Login() {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { setStaff } = useSession()
  const nav = useNavigate()

  // Tangentbordslyssnaren registreras en gång; utan ref skulle den se en
  // inaktuell `code` i sin closure.
  const codeRef = useRef('')
  codeRef.current = code

  const tryCode = useCallback(async (kod) => {
    if (kod.length < MIN_LANGD) return
    setBusy(true)
    setErr('')
    try {
      const staff = await signIn(kod)
      if (staff) {
        setStaff(staff)
        nav('/')
      } else {
        setErr('Fel kod')
        setCode('')
      }
    } catch (fel) {
      // Utan detta fastnade knappsatsen tyst för alltid vid nätverksfel.
      setErr(felText(fel))
      setCode('')
    } finally {
      setBusy(false)
    }
  }, [nav, setStaff])

  const press = useCallback((d) => {
    if (busy) return
    setErr('')
    setCode((c) => (c.length >= MAX_LANGD ? c : c + d))
  }, [busy])

  const del = useCallback(() => setCode((c) => c.slice(0, -1)), [])

  // Surfplattor har ofta tangentbord eller streckkodsläsare kopplade.
  useEffect(() => {
    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') press(e.key)
      else if (e.key === 'Backspace') del()
      else if (e.key === 'Enter') tryCode(codeRef.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, del, tryCode])

  return (
    <div className="login">
      <h1>Rapportapp</h1>
      <div className="sub">Ange din personliga kod</div>
      <div className="pin-dots" role="status" aria-label={`${code.length} av minst ${MIN_LANGD} siffror inmatade`}>
        {Array.from({ length: Math.max(MIN_LANGD, code.length) }, (_, i) => (
          <i key={i} className={i < code.length ? 'on' : ''} />
        ))}
      </div>
      <div className="err" role="alert" aria-live="assertive">{err}</div>
      <div className="keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="key" onClick={() => press(d)} disabled={busy}>{d}</button>
        ))}
        <button className="key blank" onClick={del} disabled={busy} aria-label="Radera">⌫</button>
        <button className="key" onClick={() => press('0')} disabled={busy}>0</button>
        <button className="key" onClick={() => tryCode(code)}
          disabled={busy || code.length < MIN_LANGD} aria-label="Logga in">→</button>
      </div>
    </div>
  )
}
