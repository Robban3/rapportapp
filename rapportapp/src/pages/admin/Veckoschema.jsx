import { useCallback, useEffect, useState } from 'react'
import {
  listObjects, staffForObjekt, listSchema, setSchemaRad, removeSchemaRad,
  setSchemaPersonal, removeSchemaPersonal, skapaPassFranSchema, VECKODAGAR
} from '../../lib/api.js'
import { felText } from '../../lib/errors.js'
import Feltillstand from '../../components/Feltillstand.jsx'
import Sidhuvud from '../../components/Sidhuvud.jsx'

const ROLES = ['Värd', 'Ordningsvakt', 'Garderob']
const TOM_DAG = { starttid: '', sluttid: '' }

export default function Veckoschema() {
  const [objekt, setObjekt] = useState([])
  const [objektId, setObjektId] = useState('')
  const [schema, setSchema] = useState(null)
  const [personal, setPersonal] = useState([])

  const [laddfel, setLaddfel] = useState(null)
  const [fel, setFel] = useState('')
  const [besked, setBesked] = useState('')
  const [busy, setBusy] = useState(false)
  const [dagar, setDagar] = useState(14)
  const [nyDag, setNyDag] = useState(TOM_DAG)
  const [oppenDag, setOppenDag] = useState(null)

  useEffect(() => {
    listObjects()
      .then((o) => { setObjekt(o); setObjektId((id) => id || o[0]?.id || '') })
      .catch(setLaddfel)
  }, [])

  const ladda = useCallback(async () => {
    if (!objektId) return
    setLaddfel(null)
    setFel('')
    try {
      const [rader, kopplade] = await Promise.all([listSchema(objektId), staffForObjekt(objektId)])
      setSchema(rader)
      setPersonal(kopplade)
    } catch (f) {
      setLaddfel(f)
    }
  }, [objektId])

  useEffect(() => { ladda() }, [ladda])

  async function kor(arbete) {
    if (busy) return
    setBusy(true)
    setFel('')
    setBesked('')
    try {
      await arbete()
    } catch (f) {
      setFel(felText(f))
    } finally {
      setBusy(false)
    }
  }

  const laggUppDag = (veckodag) => kor(async () => {
    await setSchemaRad(objektId, veckodag, nyDag)
    setNyDag(TOM_DAG)
    setOppenDag(null)
    setSchema(await listSchema(objektId))
  })

  const sparaTid = (rad, falt, varde) => {
    if ((rad[falt] || '') === varde.trim()) return
    return kor(async () => {
      await setSchemaRad(objektId, rad.veckodag, { ...rad, [falt]: varde.trim() })
      setSchema(await listSchema(objektId))
    })
  }

  const vaxlaAktiv = (rad) => kor(async () => {
    await setSchemaRad(objektId, rad.veckodag, { ...rad, aktiv: !rad.aktiv })
    setSchema(await listSchema(objektId))
  })

  const taBortDag = (rad) => kor(async () => {
    await removeSchemaRad(rad.id)
    setSchema(await listSchema(objektId))
  })

  const laggTillPerson = (rad, personalId) => kor(async () => {
    if (!personalId) return
    // Tiderna hämtas från dagens tider som utgångspunkt — de flesta går på
    // och av när passet börjar och slutar.
    await setSchemaPersonal(rad.id, personalId, {
      roll: 'Värd', tid_in: rad.starttid, tid_ut: rad.sluttid
    })
    setSchema(await listSchema(objektId))
  })

  const andraPerson = (rad, sp, falt, varde) => {
    // Utan jämförelsen blir varje tabb genom raden ett skriv.
    if ((sp[falt] || '') === String(varde).trim()) return
    return kor(async () => {
      await setSchemaPersonal(rad.id, sp.personal_id, { ...sp, [falt]: String(varde).trim() })
      setSchema(await listSchema(objektId))
    })
  }

  const taBortPerson = (rad, sp) => kor(async () => {
    await removeSchemaPersonal(rad.id, sp.personal_id)
    setSchema(await listSchema(objektId))
  })

  const skapaPass = () => kor(async () => {
    const { skapade, fanns } = await skapaPassFranSchema(Number(dagar))
    setBesked(
      skapade === 0
        ? `Inga nya pass. ${fanns} dagar var redan upplagda.`
        : `${skapade} pass upplagda. ${fanns} dagar var redan upplagda och lämnades orörda.`
    )
  })

  if (laddfel) return <div className="panel"><Feltillstand fel={laddfel} onForsokIgen={ladda} /></div>

  const rader = schema || []
  const lediga = VECKODAGAR.filter((d) => !rader.some((r) => r.veckodag === d.nr))

  return (
    <>
      <Sidhuvud
        titel="Veckoschema"
        beskrivning={<>Så här ser en normalvecka ut på objektet. Schemat <em>skapar</em> pass — det styr
          dem inte. En kväll som avviker rättar du på passet under Bemanning, och den ändringen
          står kvar även om du kör generatorn igen.</>}
      />

      <div className="panel">
        <div className="form-row">
          <div className="field">
            <label htmlFor="sch-objekt">Objekt</label>
            <select id="sch-objekt" value={objektId} onChange={(e) => setObjektId(e.target.value)}>
              {objekt.map((o) => <option key={o.id} value={o.id}>{o.namn}</option>)}
            </select>
          </div>
        </div>

        {schema === null ? (
          <div className="empty" style={{ marginTop: 16 }}>Laddar…</div>
        ) : (
          <>
            {rader.length === 0 && (
              <div className="empty" style={{ marginTop: 16 }}>
                Objektet har inget veckoschema. Lägg till de dagar det bemannas nedan.
              </div>
            )}

            {rader.map((rad) => {
              const dag = VECKODAGAR.find((d) => d.nr === rad.veckodag)
              const kvar = personal.filter((p) => !rad.personal.some((sp) => sp.personal_id === p.id))
              return (
                <div className={'schemadag' + (rad.aktiv ? '' : ' av')} key={rad.id}>
                  <div className="schemadag-topp">
                    <span className="dagnamn">{dag?.namn}</span>
                    {!rad.aktiv && <span className="pill">Pausad</span>}
                    {/* Ostyrda fält med `key` på det sparade värdet. Ett styrt
                        fält som skriver tillbaka i `schema` vid varje tangent
                        gör jämförelsen i sparaTid meningslös — då är det nya
                        värdet redan "det sparade" och ingenting sparas.
                        Nyckeln byts när servern svarat, så en normaliserad tid
                        (22.00 → 22:00) syns i fältet. */}
                    <input className="tinput" key={`start-${rad.starttid}`}
                      defaultValue={rad.starttid || ''} disabled={busy}
                      aria-label={`Börjar ${dag?.namn}`}
                      onBlur={(e) => sparaTid(rad, 'starttid', e.target.value)} />
                    <span className="till">–</span>
                    <input className="tinput" key={`slut-${rad.sluttid}`}
                      defaultValue={rad.sluttid || ''} disabled={busy}
                      aria-label={`Slutar ${dag?.namn}`}
                      onBlur={(e) => sparaTid(rad, 'sluttid', e.target.value)} />
                    <button className="linkbtn" onClick={() => vaxlaAktiv(rad)} disabled={busy}>
                      {rad.aktiv ? 'Pausa' : 'Aktivera'}
                    </button>
                    <button className="linkbtn fara" onClick={() => taBortDag(rad)} disabled={busy}>Ta bort</button>
                  </div>

                  {rad.personal.length === 0 ? (
                    <div className="schema-tom">
                      Ingen standardbemanning. Passet skapas ändå, men står tomt — och då kommer
                      ingen åt passloggen förrän någon bemannas.
                    </div>
                  ) : (
                    <div className="schema-personal">
                      {rad.personal.map((sp) => (
                        <div className="sp-rad" key={sp.personal_id}>
                          <span className="avatar">{sp.initialer?.slice(0, 2)}</span>
                          <span className="sp-namn">{sp.namn}</span>
                          <select value={sp.roll || ''} disabled={busy} aria-label={`Roll för ${sp.namn}`}
                            onChange={(e) => andraPerson(rad, sp, 'roll', e.target.value)}>
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <input className="tinput" key={`in-${sp.tid_in}`}
                            defaultValue={sp.tid_in || ''} disabled={busy}
                            aria-label={`Tid in för ${sp.namn}`}
                            onBlur={(e) => andraPerson(rad, sp, 'tid_in', e.target.value)} />
                          <input className="tinput" key={`ut-${sp.tid_ut}`}
                            defaultValue={sp.tid_ut || ''} disabled={busy}
                            aria-label={`Tid ut för ${sp.namn}`}
                            onBlur={(e) => andraPerson(rad, sp, 'tid_ut', e.target.value)} />
                          <button className="linkbtn fara" onClick={() => taBortPerson(rad, sp)} disabled={busy}>
                            Ta bort
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {kvar.length > 0 && (
                    <select className="lagg-till" value="" disabled={busy}
                      aria-label={`Lägg till på ${dag?.namn}`}
                      onChange={(e) => laggTillPerson(rad, e.target.value)}>
                      <option value="">Lägg till i standardbemanningen…</option>
                      {kvar.map((p) => <option key={p.id} value={p.id}>{p.namn} ({p.initialer})</option>)}
                    </select>
                  )}
                </div>
              )
            })}

            {lediga.length > 0 && (
              <div className="ny-dag">
                <div className="mini-lbl">Lägg till en dag</div>
                <div className="form-row" style={{ marginTop: 0 }}>
                  <div className="field" style={{ maxWidth: 150 }}>
                    <label htmlFor="sch-dag">Veckodag</label>
                    <select id="sch-dag" value={oppenDag || ''} onChange={(e) => setOppenDag(e.target.value)}>
                      <option value="">Välj…</option>
                      {lediga.map((d) => <option key={d.nr} value={d.nr}>{d.namn}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ maxWidth: 120 }}>
                    <label htmlFor="sch-start">Börjar</label>
                    <input id="sch-start" value={nyDag.starttid} placeholder="14:30"
                      onChange={(e) => setNyDag({ ...nyDag, starttid: e.target.value })} />
                  </div>
                  <div className="field" style={{ maxWidth: 120 }}>
                    <label htmlFor="sch-slut">Slutar</label>
                    <input id="sch-slut" value={nyDag.sluttid} placeholder="03:00"
                      onChange={(e) => setNyDag({ ...nyDag, sluttid: e.target.value })} />
                  </div>
                  <button className="btn" disabled={busy || !oppenDag || !nyDag.starttid.trim()}
                    onClick={() => laggUppDag(Number(oppenDag))}>Lägg till dagen</button>
                </div>
              </div>
            )}
          </>
        )}

        {fel && <div className="err" role="alert" style={{ height: 'auto', marginTop: 10 }}>{fel}</div>}
      </div>

      {/* Generatorn går över ALLA objekt, inte bara det valda — den läggs
          därför i en egen panel, så det inte ser ut som en knapp för objektet
          ovanför. */}
      <div className="panel">
        <div className="mini-lbl">Skapa pass ur schemat</div>
        <p className="stat-hint">
          Lägger upp pass för alla aktiva objekt med schema. En dag som redan har ett pass
          lämnas orörd — kör den hur ofta du vill.
        </p>
        <div className="form-row" style={{ marginTop: 0 }}>
          <div className="field" style={{ maxWidth: 150 }}>
            <label htmlFor="sch-dagar">Antal dagar framåt</label>
            <input id="sch-dagar" type="number" min="1" max="90" value={dagar}
              onChange={(e) => setDagar(e.target.value)} />
          </div>
          <button className="btn primary" onClick={skapaPass} disabled={busy}>
            {busy ? 'Skapar…' : 'Skapa passen'}
          </button>
        </div>
        {besked && <div className="inc-hint" role="status">{besked}</div>}
      </div>
    </>
  )
}
