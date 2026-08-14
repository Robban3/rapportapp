import { useCallback, useEffect, useState } from 'react'
import { listStaff, addStaff, listObjects, staffObjects, setStaffObjects } from '../../lib/api.js'
import { felText } from '../../lib/errors.js'
import Feltillstand from '../../components/Feltillstand.jsx'

const ROLES = ['Värd', 'Ordningsvakt', 'Garderob', 'Admin']
const TOM_FORM = { namn: '', initialer: '', roll: 'Värd', kod: '' }

export default function Staff() {
  const [staff, setStaff] = useState(null)
  const [objekt, setObjekt] = useState([])
  const [laddfel, setLaddfel] = useState(null)
  const [form, setForm] = useState(TOM_FORM)
  const [formfel, setFormfel] = useState('')
  const [sparar, setSparar] = useState(false)
  const [linking, setLinking] = useState(null) // { person, selected:Set, sparar }

  const reload = useCallback(async () => {
    setLaddfel(null)
    try {
      const [personal, objektlista] = await Promise.all([listStaff(), listObjects()])
      setStaff(personal)
      setObjekt(objektlista)
    } catch (fel) {
      setLaddfel(fel)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  async function create(e) {
    e.preventDefault()
    if (sparar) return
    setSparar(true)
    setFormfel('')
    try {
      await addStaff({ ...form, initialer: form.initialer.toUpperCase() })
      setForm(TOM_FORM)
      await reload()
    } catch (fel) {
      // Tidigare avbröts detta tyst, så admin trodde att personen sparats.
      setFormfel(felText(fel))
    } finally {
      setSparar(false)
    }
  }

  async function openLink(person) {
    try {
      const ids = await staffObjects(person.id)
      setLinking({ person, selected: new Set(ids), fel: '' })
    } catch (fel) {
      setLaddfel(fel)
    }
  }

  function toggle(oid) {
    setLinking((l) => {
      const s = new Set(l.selected)
      if (s.has(oid)) s.delete(oid)
      else s.add(oid)
      return { ...l, selected: s }
    })
  }

  async function saveLink() {
    if (linking.sparar) return
    setLinking((l) => ({ ...l, sparar: true, fel: '' }))
    try {
      await setStaffObjects(linking.person.id, [...linking.selected])
      setLinking(null)
    } catch (fel) {
      setLinking((l) => ({ ...l, sparar: false, fel: felText(fel) }))
    }
  }

  if (laddfel) return <div className="panel"><Feltillstand fel={laddfel} onForsokIgen={reload} /></div>

  return (
    <div className="panel">
      <div className="h3">Personal &amp; behörighet</div>
      <div className="meta">Lägg till personal och koppla vilka objekt de får rapportera på. En person ser bara sina kopplade objekt i appen.</div>

      {staff === null ? (
        <div className="empty">Laddar…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Sign.</th><th>Namn</th><th>Roll</th><th>Kod</th><th>Behörighet</th></tr></thead>
            <tbody>
              {staff.map((p) => (
                <tr key={p.id}>
                  <td><span className="avatar">{p.initialer?.slice(0, 2)}</span></td>
                  <td style={{ fontWeight: 700 }}>{p.namn} <span style={{ color: 'var(--dim)', fontWeight: 600 }}>({p.initialer})</span></td>
                  <td>{p.roll}</td>
                  <td><code>{p.kod}</code></td>
                  <td><button className="linkbtn" onClick={() => openLink(p)}>Koppla objekt →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mini-lbl" style={{ marginTop: 20 }}>Lägg till personal</div>
      <form className="form-row" onSubmit={create}>
        <div className="field">
          <label htmlFor="ny-namn">Namn</label>
          <input id="ny-namn" value={form.namn} onChange={(e) => setForm({ ...form, namn: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ny-initialer">Signatur</label>
          <input id="ny-initialer" value={form.initialer} maxLength={6} placeholder="t.ex. ANLA"
            onChange={(e) => setForm({ ...form, initialer: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ny-roll">Roll</label>
          <select id="ny-roll" value={form.roll} onChange={(e) => setForm({ ...form, roll: e.target.value })}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ny-kod">Personlig kod</label>
          <input id="ny-kod" value={form.kod} maxLength={8} inputMode="numeric"
            onChange={(e) => setForm({ ...form, kod: e.target.value })} />
        </div>
        <button className="btn primary" type="submit" disabled={sparar}>
          {sparar ? 'Sparar…' : 'Lägg till'}
        </button>
      </form>
      {formfel && <div className="err" role="alert" style={{ height: 'auto', marginTop: 10 }}>{formfel}</div>}

      {linking && (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="koppla-rubrik">
            <h3 id="koppla-rubrik">Koppla objekt — {linking.person.initialer}</h3>
            <div className="sub">Bocka i de objekt {linking.person.namn} får rapportera på.</div>
            {objekt.map((o) => (
              <label className="obj-check" key={o.id}>
                <input type="checkbox" checked={linking.selected.has(o.id)} onChange={() => toggle(o.id)} />
                {o.namn}
              </label>
            ))}
            {linking.fel && <div className="err" role="alert" style={{ height: 'auto', marginTop: 10 }}>{linking.fel}</div>}
            <div className="row-end">
              {/* Klick utanför stänger inte längre — det kastade osparade kryssrutor. */}
              <button className="btn" onClick={() => setLinking(null)} disabled={linking.sparar}>Avbryt</button>
              <button className="btn primary" onClick={saveLink} disabled={linking.sparar}>
                {linking.sparar ? 'Sparar…' : 'Spara'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
