import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { objectsForStaff } from '../lib/api.js'
import { useSession } from '../state/session.jsx'
import Feltillstand from '../components/Feltillstand.jsx'

export default function Objects() {
  const { staff } = useSession()
  const [objekt, setObjekt] = useState(null)
  const [fel, setFel] = useState(null)
  const nav = useNavigate()

  const ladda = useCallback(() => {
    setFel(null)
    setObjekt(null)
    objectsForStaff(staff.id).then(setObjekt).catch(setFel)
  }, [staff.id])

  useEffect(() => { ladda() }, [ladda])

  return (
    <div>
      <div className="page-title">Välj objekt</div>
      <div className="page-sub">Du ser bara de objekt du är kopplad till. Tryck för att öppna passet.</div>
      {fel ? (
        <Feltillstand fel={fel} onForsokIgen={ladda} />
      ) : objekt === null ? (
        <div className="empty">Laddar…</div>
      ) : objekt.length === 0 ? (
        <div className="empty">Du är inte kopplad till något objekt ännu. Be en administratör koppla dig.</div>
      ) : (
        <div className="obj-list">
          {objekt.map((o) => (
            <button key={o.id} className="obj-card" onClick={() => nav(`/objekt/${o.id}`)}>
              <span className="obj-ico">{initials(o.namn)}</span>
              <span>
                <span className="obj-name">{o.namn}</span>
                <span className="obj-sub" style={{ display: 'block' }}>{o.kund_epost}</span>
              </span>
              <span className="status st-on">Öppna</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function initials(namn) {
  return namn.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}
