import { useCallback, useEffect, useState } from 'react'
import { listStaff, addStaff, listObjects, staffObjects, setStaffObjects, bjudInPersonal, setStaffAktiv } from '../../lib/api.js'
import { felText } from '../../lib/errors.js'
import { useSession } from '../../state/sessionCtx.js'
import Feltillstand from '../../components/Feltillstand.jsx'
import Sidhuvud from '../../components/Sidhuvud.jsx'

const ROLES = ['Värd', 'Ordningsvakt', 'Garderob', 'Admin']
const TOM_FORM = { namn: '', initialer: '', roll: 'Värd', epost: '' }

export default function Staff() {
  // Den inloggade får inte stänga av sig själv. Datalagret stoppar det också,
  // men en knapp som alltid nekar är sämre än ingen knapp alls.
  const { staff: jag } = useSession()
  const [staff, setStaff] = useState(null)
  const [objekt, setObjekt] = useState([])
  const [laddfel, setLaddfel] = useState(null)
  const [form, setForm] = useState(TOM_FORM)
  const [formfel, setFormfel] = useState('')
  const [sparar, setSparar] = useState(false)
  const [linking, setLinking] = useState(null) // { person, selected:Set, sparar }
  const [bjuder, setBjuder] = useState(null)   // personal-id som bjuds in just nu
  const [vaxlar, setVaxlar] = useState(null)   // personal-id som stängs av eller öppnas
  const [avstanger, setAvstanger] = useState(null) // person som bekräftelserutan gäller
  const [inbjudan, setInbjudan] = useState('') // kvitto efter lyckad inbjudan

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

  async function bjudIn(person) {
    if (bjuder) return
    setBjuder(person.id)
    setFormfel('')
    setInbjudan('')
    try {
      await bjudInPersonal(person.epost)
      setInbjudan(`Inbjudan skickad till ${person.epost}.`)
      await reload()
    } catch (fel) {
      setFormfel(felText(fel))
    } finally {
      setBjuder(null)
    }
  }

  async function vaxlaAktiv(person, aktiv) {
    if (vaxlar) return
    setVaxlar(person.id)
    setFormfel('')
    setInbjudan('')
    try {
      await setStaffAktiv(person.id, aktiv)
      setAvstanger(null)
      await reload()
    } catch (fel) {
      setAvstanger(null)
      setFormfel(felText(fel))
    } finally {
      setVaxlar(null)
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
    <>
      <Sidhuvud
        titel="Personal & behörighet"
        beskrivning="Lägg till personal och koppla vilka objekt de får rapportera på. En person ser bara sina kopplade objekt i appen. Inloggningen sköts av Supabase Auth — lägg upp personen med rätt e-post och tryck Bjud in, så knyts konto och personalrad ihop automatiskt."
      />

      <div className="panel">

      {staff === null ? (
        <div className="empty">Laddar…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Sign.</th><th>Namn</th><th>Roll</th><th>E-post</th><th>Konto</th><th>Behörighet</th><th>Status</th></tr></thead>
            <tbody>
              {staff.map((p) => (
                <tr key={p.id} className={p.aktiv ? '' : 'avstangd'}>
                  <td><span className="avatar">{p.initialer?.slice(0, 2)}</span></td>
                  <td style={{ fontWeight: 700 }}>{p.namn} <span style={{ color: 'var(--dim)', fontWeight: 600 }}>({p.initialer})</span></td>
                  <td>{p.roll}</td>
                  <td>{p.epost || <span style={{ color: 'var(--dim)' }}>—</span>}</td>
                  {/* Utan kopplat konto kan personen inte logga in, hur rätt
                      allt annat än är. Det ska synas direkt i listan. */}
                  <td>
                    {p.auth_user_id ? (
                      <span className="pill sent" style={{ marginLeft: 0 }}>Konto finns</span>
                    ) : (
                      <button className="linkbtn" disabled={!p.epost || bjuder === p.id}
                        onClick={() => bjudIn(p)}>
                        {bjuder === p.id ? 'Bjuder in…' : 'Bjud in →'}
                      </button>
                    )}
                  </td>
                  <td><button className="linkbtn" onClick={() => openLink(p)}>Koppla objekt →</button></td>
                  {/* Avstängning är den enda spärren när någon slutar. Utan
                      den här knappen låg den kvar i databasen utan väg dit. */}
                  <td>
                    {p.aktiv ? (
                      p.id === jag?.id ? (
                        <span style={{ color: 'var(--dim)', fontSize: 12 }}>Du</span>
                      ) : (
                        <button className="linkbtn fara" disabled={vaxlar === p.id}
                          onClick={() => setAvstanger(p)}>
                          {vaxlar === p.id ? 'Stänger av…' : 'Stäng av'}
                        </button>
                      )
                    ) : (
                      <>
                        <span className="pill">Avstängd</span>{' '}
                        <button className="linkbtn" disabled={vaxlar === p.id}
                          onClick={() => vaxlaAktiv(p, true)}>
                          {vaxlar === p.id ? 'Öppnar…' : 'Aktivera'}
                        </button>
                      </>
                    )}
                  </td>
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
          <label htmlFor="ny-epost">E-post</label>
          <input id="ny-epost" type="email" value={form.epost} inputMode="email"
            autoCapitalize="none" autoCorrect="off"
            onChange={(e) => setForm({ ...form, epost: e.target.value })} />
        </div>
        <button className="btn primary" type="submit" disabled={sparar}>
          {sparar ? 'Sparar…' : 'Lägg till'}
        </button>
      </form>
      {formfel && <div className="err" role="alert" style={{ height: 'auto', marginTop: 10 }}>{formfel}</div>}
      {inbjudan && <div className="kvitto" role="status">{inbjudan}</div>}

      {/* Avstängning tar åtkomsten direkt, mitt i ett pågående pass om det
          är illa. Den frågan ställs en gång till. */}
      {avstanger && (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="avstang-rubrik">
            <h3 id="avstang-rubrik">Stäng av {avstanger.namn}?</h3>
            <div className="sub">
              {avstanger.initialer} kan inte längre logga in och tappar åtkomsten till alla
              passloggar direkt — även ett pass som pågår just nu.
            </div>
            <div className="rep" style={{ marginTop: 12 }}>
              <div className="rrow"><div className="rt">Kvar</div><div>Gamla inlägg står kvar, signerade med {avstanger.initialer}. Inget raderas.</div></div>
              <div className="rrow"><div className="rt">Ångra</div><div>Går att aktivera igen när som helst.</div></div>
            </div>
            <div className="row-end">
              <button className="btn" onClick={() => setAvstanger(null)} disabled={vaxlar === avstanger.id}>Avbryt</button>
              <button className="btn primary" onClick={() => vaxlaAktiv(avstanger, false)}
                disabled={vaxlar === avstanger.id}>
                {vaxlar === avstanger.id ? 'Stänger av…' : 'Stäng av'}
              </button>
            </div>
          </div>
        </div>
      )}

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
    </>
  )
}
