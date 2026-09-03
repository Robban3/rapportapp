import { useState } from 'react'
import { Link } from 'react-router-dom'
import { begarAterstallning } from '../lib/api.js'
import { felText } from '../lib/errors.js'

/**
 * Begär en återställningslänk.
 *
 * Sidan berättar aldrig om adressen finns. Ett "okänd adress" hade gjort
 * inloggningssidan till ett sätt att kartlägga vilka som jobbar här.
 */
export default function Aterstall() {
  const [epost, setEpost] = useState('')
  const [skickat, setSkickat] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      await begarAterstallning(epost)
      setSkickat(true)
    } catch (fel) {
      setErr(felText(fel))
    } finally {
      setBusy(false)
    }
  }

  if (skickat) {
    return (
      <div className="login">
        <h1>Kolla mejlen</h1>
        <div className="sub">
          Finns <b>{epost.trim().toLowerCase()}</b> hos oss ligger det nu en länk där.
          Den gäller en timme.
        </div>
        <div className="login-hint">
          Inget mejl? Titta i skräpposten. Är adressen inte upplagd som personal
          kommer inget — be en administratör bjuda in dig i stället.
        </div>
        <div className="login-hjalp"><Link to="/login">Tillbaka till inloggningen</Link></div>
      </div>
    )
  }

  return (
    <div className="login">
      <h1>Återställ lösenord</h1>
      <div className="sub">Fyll i din e-postadress, så skickar vi en länk.</div>

      <form className="login-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="ater-epost">E-post</label>
          <input id="ater-epost" type="email" value={epost} autoComplete="username"
            inputMode="email" autoCapitalize="none" autoCorrect="off" required
            onChange={(e) => setEpost(e.target.value)} />
        </div>

        <div className="err" role="alert" aria-live="assertive">{err}</div>

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? 'Skickar…' : 'Skicka återställningslänk'}
        </button>
      </form>

      <div className="login-hjalp"><Link to="/login">Tillbaka till inloggningen</Link></div>
    </div>
  )
}
