import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { passList } from '../../lib/api.js'
import Feltillstand from '../../components/Feltillstand.jsx'

export default function ReviewList({ status, title }) {
  const [rows, setRows] = useState(null)
  const [fel, setFel] = useState(null)
  const statusNyckel = status.join(',')

  const ladda = useCallback(() => {
    setFel(null)
    setRows(null)
    passList(statusNyckel.split(',')).then(setRows).catch(setFel)
  }, [statusNyckel])

  useEffect(() => { ladda() }, [ladda])

  return (
    <div className="panel">
      <div className="h3">{title}</div>
      <div className="meta">Välj ett pass för att granska den sammanställda rapporten.</div>
      {fel ? (
        <Feltillstand fel={fel} onForsokIgen={ladda} />
      ) : rows === null ? (
        <div className="empty">Laddar…</div>
      ) : rows.length === 0 ? (
        <div className="empty">Inga pass här.</div>
      ) : (
        <table className="table">
          <thead><tr><th>Objekt</th><th>Datum</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 700 }}>{p.objekt_namn}</td>
                <td>{p.datum}</td>
                <td><span className={'pill ' + (p.status === 'skickat' ? 'sent' : 'review')}>{statusText(p.status)}</span></td>
                <td style={{ textAlign: 'right' }}><Link className="linkbtn" to={`/admin/pass/${p.id}`}>Öppna →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const statusText = (s) => ({ oppet: 'Öppet', granskas: 'Granskas', skickat: 'Skickat' }[s] || s)
