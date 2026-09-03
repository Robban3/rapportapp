import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signIn } from '../lib/api.js'
import { hasSupabase } from '../lib/supabase.js'
import { useSession } from '../state/sessionCtx.js'
import { felText } from '../lib/errors.js'

export default function Login() {
  const [epost, setEpost] = useState('')
  const [losenord, setLosenord] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { setStaff } = useSession()
  const nav = useNavigate()

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const staff = await signIn(epost, losenord)
      if (!staff) {
        setErr('Fel e-post eller lösenord.')
        return
      }
      setStaff(staff)
      nav('/')
    } catch (fel) {
      setErr(felText(fel))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <h1>Rapportapp</h1>
      <div className="sub">Logga in för att öppna passet</div>

      <form className="login-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="login-epost">E-post</label>
          {/* autoComplete gör att lösenordshanteraren fyller i åt värden —
              på en delad surfplatta är det skillnaden mellan att logga in på
              tio sekunder och att knappa in adressen med handskar på. */}
          <input id="login-epost" type="email" value={epost} autoComplete="username"
            inputMode="email" autoCapitalize="none" autoCorrect="off" required
            onChange={(e) => setEpost(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="login-losenord">Lösenord</label>
          <input id="login-losenord" type="password" value={losenord}
            autoComplete="current-password" required
            onChange={(e) => setLosenord(e.target.value)} />
        </div>

        <div className="err" role="alert" aria-live="assertive">{err}</div>

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? 'Loggar in…' : 'Logga in'}
        </button>
      </form>

      {/* Utan den här länken är en glömd lösenord en total utelåsning: en
          inbjudan går inte att skicka om till någon som redan har konto, så
          enda vägen tillbaka var att en admin gick in i Supabase-panelen. */}
      {hasSupabase && (
        <div className="login-hjalp">
          <Link to="/aterstall">Glömt lösenordet?</Link>
        </div>
      )}

      {!hasSupabase && (
        <div className="login-hint">
          Demoläge — lösenordet ignoreras. Prova <b>zaem@example.se</b> (bemannad värd),
          <b> varo@example.se</b> (ej bemannad) eller <b>admin@example.se</b>.
        </div>
      )}
    </div>
  )
}
