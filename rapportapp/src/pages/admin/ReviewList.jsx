import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { passList } from '../../lib/api.js'
import Feltillstand from '../../components/Feltillstand.jsx'
import Sidhuvud from '../../components/Sidhuvud.jsx'

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
    <>
      <Sidhuvud titel={title} beskrivning="Välj ett pass för att granska den sammanställda rapporten." />
      <div className="panel">
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
                <td><span className={'pill ' + pillKlass(p.status)}>{statusText(p.status)}</span></td>
                <td style={{ textAlign: 'right' }}><Link className="linkbtn" to={`/admin/pass/${p.id}`}>Öppna →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </div>
    </>
  )
}

// `last` betyder att loggen är stängd men rapporten inte bekräftat levererad.
// Den ska inte se ut som en skickad rapport — det var precis den förväxlingen
// som gjorde att ett bortfall kunde passera obemärkt.
const statusText = (s) =>
  ({ oppet: 'Öppet', granskas: 'Granskas', last: 'Ej skickad', skickat: 'Skickat' }[s] || s)

const pillKlass = (s) => (s === 'skickat' ? 'sent' : s === 'last' ? 'fara' : 'review')
