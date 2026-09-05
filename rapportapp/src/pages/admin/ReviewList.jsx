import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { passList, listObjects } from '../../lib/api.js'
import Feltillstand from '../../components/Feltillstand.jsx'
import Sidhuvud from '../../components/Sidhuvud.jsx'

const SIDSTORLEK = 50

export default function ReviewList({ status, title }) {
  const [rows, setRows] = useState(null)
  const [fler, setFler] = useState(false)
  const [sida, setSida] = useState(0)
  const [objekt, setObjekt] = useState([])
  const [objektId, setObjektId] = useState('')
  const [fran, setFran] = useState('')
  const [fel, setFel] = useState(null)
  const statusNyckel = status.join(',')

  useEffect(() => {
    listObjects({ inklInaktiva: true }).then(setObjekt).catch(() => { /* filtret är valfritt */ })
  }, [])

  // Ett filter ska alltid börja om från första sidan, annars visas sida tre av
  // ett resultat som bara har en.
  useEffect(() => { setSida(0) }, [objektId, fran, statusNyckel])

  const ladda = useCallback(() => {
    setFel(null)
    setRows(null)
    passList(statusNyckel.split(','), {
      objektId: objektId || null,
      fran: fran || null,
      sida,
      sidstorlek: SIDSTORLEK
    })
      .then(({ rader, fler }) => { setRows(rader); setFler(fler) })
      .catch(setFel)
  }, [statusNyckel, objektId, fran, sida])

  useEffect(() => { ladda() }, [ladda])

  return (
    <>
      <Sidhuvud titel={title} beskrivning="Välj ett pass för att granska den sammanställda rapporten." />
      <div className="panel">

      {/* Utan filter blir listan omöjlig att söka i efter ett halvår: "vad
          hände på Draken den tredje augusti?" krävde att man bläddrade. */}
      <div className="form-row">
        <div className="field">
          <label htmlFor="rl-objekt">Objekt</label>
          <select id="rl-objekt" value={objektId} onChange={(e) => setObjektId(e.target.value)}>
            <option value="">Alla objekt</option>
            {objekt.map((o) => <option key={o.id} value={o.id}>{o.namn}</option>)}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 170 }}>
          <label htmlFor="rl-fran">Från och med</label>
          <input id="rl-fran" type="date" value={fran} onChange={(e) => setFran(e.target.value)} />
        </div>
      </div>

      {fel ? (
        <Feltillstand fel={fel} onForsokIgen={ladda} />
      ) : rows === null ? (
        <div className="empty">Laddar…</div>
      ) : rows.length === 0 ? (
        <div className="empty">{objektId || fran ? 'Inga pass matchar filtret.' : 'Inga pass här.'}</div>
      ) : (
        <>
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

          {(sida > 0 || fler) && (
            <div className="sidfot-nav">
              <button className="btn" disabled={sida === 0} onClick={() => setSida((n) => n - 1)}>← Föregående</button>
              <span className="sidnr">Sida {sida + 1}</span>
              <button className="btn" disabled={!fler} onClick={() => setSida((n) => n + 1)}>Nästa →</button>
            </div>
          )}
        </>
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
