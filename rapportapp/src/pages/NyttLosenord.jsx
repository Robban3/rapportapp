import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { settNyttLosenord } from '../lib/api.js'
import { useSession } from '../state/sessionCtx.js'
import { hasSupabase, supabase } from '../lib/supabase.js'
import { felText } from '../lib/errors.js'

/**
 * Sätter ett nytt lösenord efter att någon klickat på återställningslänken.
 *
 * Länken bär en engångstoken i adressens fragment. supabase-js läser den vid
 * start och byter den mot en tillfällig session — det är därför sidan inte
 * behöver plocka isär URL:en själv. Sessionen gäller bara lösenordsbytet.
 */
export default function NyttLosenord() {
  const [losenord, setLosenord] = useState('')
  const [upprepa, setUpprepa] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // null = vet inte än. Sessionen dyker upp först när supabase-js läst
  // fragmentet, och utan väntan blinkar "länken har gått ut" förbi varje gång.
  const [harSession, setHarSession] = useState(null)
  const { setStaff } = useSession()
  const nav = useNavigate()

  useEffect(() => {
    if (!hasSupabase) { setHarSession(false); return }
    let levande = true

    supabase.auth.getSession().then(({ data }) => {
      if (levande && data.session) setHarSession(true)
    })

    // PASSWORD_RECOVERY kommer när token i länken lösts in. Händelsen kan
    // hinna före getSession ovan, eller efter — därför lyssnar vi på båda.
    const { data } = supabase.auth.onAuthStateChange((_h, session) => {
      if (levande) setHarSession(Boolean(session))
    })

    // Kommer ingen session inom rimlig tid var länken använd eller för gammal.
    const timer = setTimeout(() => { if (levande) setHarSession((n) => n ?? false) }, 2500)

    return () => {
      levande = false
      clearTimeout(timer)
      data.subscription.unsubscribe()
    }
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (losenord !== upprepa) {
      setErr('Lösenorden är inte lika.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const personal = await settNyttLosenord(losenord)
      // Bytet loggar in personen direkt — ingen ska behöva skriva lösenordet
      // två gånger i rad kl 02:00.
      if (personal) {
        setStaff(personal)
        nav('/')
        return
      }
      // Kontot finns i auth men saknar personalrad. Lösenordet är bytt, men
      // appen har ingen plats att skicka personen till.
      setErr('Lösenordet är bytt, men kontot är inte kopplat till någon personal. Be en administratör lägga upp dig.')
    } catch (fel) {
      setErr(felText(fel))
    } finally {
      setBusy(false)
    }
  }

  if (harSession === null) {
    return <div className="login"><div className="sub">Kontrollerar länken…</div></div>
  }

  if (!harSession) {
    return (
      <div className="login">
        <h1>Länken gäller inte</h1>
        <div className="sub">
          Återställningslänken har gått ut eller är redan använd. Begär en ny, så
          skickar vi en färsk.
        </div>
        <div className="login-hjalp"><Link to="/aterstall">Begär ny länk</Link></div>
      </div>
    )
  }

  return (
    <div className="login">
      <h1>Nytt lösenord</h1>
      <div className="sub">Välj ett lösenord på minst 8 tecken.</div>

      <form className="login-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="nytt-los">Nytt lösenord</label>
          <input id="nytt-los" type="password" value={losenord} autoComplete="new-password"
            required minLength={8} onChange={(e) => setLosenord(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="nytt-los-igen">Upprepa lösenordet</label>
          <input id="nytt-los-igen" type="password" value={upprepa} autoComplete="new-password"
            required minLength={8} onChange={(e) => setUpprepa(e.target.value)} />
        </div>

        <div className="err" role="alert" aria-live="assertive">{err}</div>

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? 'Sparar…' : 'Spara lösenordet'}
        </button>
      </form>
    </div>
  )
}
