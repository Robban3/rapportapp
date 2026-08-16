import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { objectsForStaff, objektStatusForStaff } from '../lib/api.js'
import { useSession } from '../state/session.jsx'
import Feltillstand from '../components/Feltillstand.jsx'

const STATUSTEXT = {
  bemannad: 'Öppna',
  ej_bemannad: 'Ej bemannad',
  inget_pass: 'Inget pass nu'
}

export default function Objects() {
  const { staff } = useSession()
  const [objekt, setObjekt] = useState(null)
  const [status, setStatus] = useState({})
  const [fel, setFel] = useState(null)
  const nav = useNavigate()

  const ladda = useCallback(() => {
    setFel(null)
    setObjekt(null)
    // Statusen hämtas innan listan visas: kortet ska aldrig hinna säga
    // "Öppna" och sedan byta till "Ej bemannad".
    objectsForStaff(staff.id)
      .then(async (mina) => {
        setStatus(await objektStatusForStaff(staff.id, mina.map((o) => o.id)))
        setObjekt(mina)
      })
      .catch(setFel)
  }, [staff.id])

  useEffect(() => { ladda() }, [ladda])

  return (
    <div>
      <div className="page-title">Välj objekt</div>
      <div className="page-sub">Du ser bara de objekt du är kopplad till. Passet öppnas när det startar, och stängs när det slutar — även när det pågår över midnatt.</div>
      {fel ? (
        <Feltillstand fel={fel} onForsokIgen={ladda} />
      ) : objekt === null ? (
        <div className="empty">Laddar…</div>
      ) : objekt.length === 0 ? (
        <div className="empty">Du är inte kopplad till något objekt ännu. Be en administratör koppla dig.</div>
      ) : (
        <div className="obj-list">
          {objekt.map((o) => {
            const s = status[o.id] || 'inget_pass'
            return (
              // Även objekt utan pågående pass går att trycka på — passloggen
              // förklarar vad som saknas. En låst knapp hade bara varit tyst.
              <button key={o.id} className="obj-card" onClick={() => nav(`/objekt/${o.id}`)}>
                <span className="obj-ico">{initials(o.namn)}</span>
                <span>
                  <span className="obj-name">{o.namn}</span>
                  <span className="obj-sub" style={{ display: 'block' }}>{o.kund_epost}</span>
                </span>
                <span className={'status ' + (s === 'bemannad' ? 'st-on' : 'st-off')}>
                  {STATUSTEXT[s]}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function initials(namn) {
  return namn.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}
