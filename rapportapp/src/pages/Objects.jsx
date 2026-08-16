import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { objectsForStaff, rosteredObjektIds } from '../lib/api.js'
import { useSession } from '../state/session.jsx'
import Feltillstand from '../components/Feltillstand.jsx'

export default function Objects() {
  const { staff } = useSession()
  const [objekt, setObjekt] = useState(null)
  const [bemannade, setBemannade] = useState(new Set())
  const [fel, setFel] = useState(null)
  const nav = useNavigate()

  const ladda = useCallback(() => {
    setFel(null)
    setObjekt(null)
    // Båda hämtas tillsammans: kortet ska aldrig hinna visa "Öppna" innan
    // bemanningen är känd och sedan byta till "Ej bemannad".
    Promise.all([objectsForStaff(staff.id), rosteredObjektIds(staff.id)])
      .then(([mina, bemannadePa]) => {
        setBemannade(new Set(bemannadePa))
        setObjekt(mina)
      })
      .catch(setFel)
  }, [staff.id])

  useEffect(() => { ladda() }, [ladda])

  return (
    <div>
      <div className="page-title">Välj objekt</div>
      <div className="page-sub">Du ser bara de objekt du är kopplad till, och kan skriva i passet de dagar du är bemannad.</div>
      {fel ? (
        <Feltillstand fel={fel} onForsokIgen={ladda} />
      ) : objekt === null ? (
        <div className="empty">Laddar…</div>
      ) : objekt.length === 0 ? (
        <div className="empty">Du är inte kopplad till något objekt ännu. Be en administratör koppla dig.</div>
      ) : (
        <div className="obj-list">
          {objekt.map((o) => {
            const bemannad = bemannade.has(o.id)
            return (
              // Obemannade objekt går fortfarande att trycka på — passloggen
              // förklarar vad som saknas. En låst knapp hade bara varit tyst.
              <button key={o.id} className="obj-card" onClick={() => nav(`/objekt/${o.id}`)}>
                <span className="obj-ico">{initials(o.namn)}</span>
                <span>
                  <span className="obj-name">{o.namn}</span>
                  <span className="obj-sub" style={{ display: 'block' }}>{o.kund_epost}</span>
                </span>
                <span className={'status ' + (bemannad ? 'st-on' : 'st-off')}>
                  {bemannad ? 'Öppna' : 'Ej bemannad'}
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
