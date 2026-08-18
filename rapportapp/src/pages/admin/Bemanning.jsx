import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listObjects, openPassForObjekt, passForObjektDatum, setPassTider,
  rosterForPass, setRosterEntry, removeRosterEntry, staffForObjekt,
  senasteBemannadePass, kopieraBemanning
} from '../../lib/api.js'
import { verksamhetsdatum, passFonster } from '../../lib/time.js'
import { felText } from '../../lib/errors.js'
import Feltillstand from '../../components/Feltillstand.jsx'

const ROLES = ['Värd', 'Ordningsvakt', 'Garderob']
const TOM_RAD = { personalId: '', roll: 'Värd', tid_in: '', tid_ut: '' }

export default function Bemanning() {
  const [objekt, setObjekt] = useState([])
  const [objektId, setObjektId] = useState('')
  const [datum, setDatum] = useState(verksamhetsdatum())

  // `null` = laddar, `false` = inget pass upplagt för objekt+datum.
  const [pass, setPass] = useState(null)
  const [roster, setRoster] = useState([])
  const [personal, setPersonal] = useState([])
  const [forra, setForra] = useState(null)

  const [laddfel, setLaddfel] = useState(null)
  const [tider, setTider] = useState({ starttid: '', sluttid: '' })
  const [nyRad, setNyRad] = useState(TOM_RAD)
  const [fel, setFel] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listObjects()
      .then((o) => { setObjekt(o); setObjektId((id) => id || o[0]?.id || '') })
      .catch(setLaddfel)
  }, [])

  // Vilket objekt+datum som senast begärdes. Utan den kan ett långsamt svar
  // för det förra objektet skriva över ett snabbare för det nya, så att admin
  // bemannar fel pass — och bemanningen är åtkomstkontrollen.
  const senasteBegaran = useRef(0)

  const ladda = useCallback(async () => {
    if (!objektId || !datum) return
    const min = ++senasteBegaran.current
    const aktuell = () => senasteBegaran.current === min

    setLaddfel(null)
    setFel('')
    setPass(null)
    try {
      const [p, kopplade, tidigare] = await Promise.all([
        passForObjektDatum(objektId, datum),
        staffForObjekt(objektId),
        senasteBemannadePass(objektId, datum)
      ])
      if (!aktuell()) return

      setPersonal(kopplade)
      setForra(tidigare)

      if (!p) {
        setPass(false)
        setRoster([])
        // Förra passet väger tyngst — det speglar hur det faktiskt ser ut just
        // här. Finns inget sådant tas objektets standardtider. Utan endera
        // fick admin knappa in samma tider varje kväll.
        const valt = objekt.find((o) => o.id === objektId)
        setTider({
          starttid: tidigare?.pass.starttid || valt?.standard_starttid || '',
          sluttid: tidigare?.pass.sluttid || valt?.standard_sluttid || ''
        })
        return
      }

      const rader = await rosterForPass(p.id)
      if (!aktuell()) return

      setPass(p)
      setTider({ starttid: p.starttid || '', sluttid: p.sluttid || '' })
      setRoster(rader)
    } catch (f) {
      if (aktuell()) setLaddfel(f)
    }
  }, [objektId, datum, objekt])

  useEffect(() => { ladda() }, [ladda])

  async function kor(arbete) {
    if (busy) return
    setBusy(true)
    setFel('')
    try {
      await arbete()
    } catch (f) {
      setFel(felText(f))
    } finally {
      setBusy(false)
    }
  }

  const laggUppPass = () => kor(async () => {
    // Starttiden skickas rakt igenom. `|| undefined` här hade fallit tillbaka
    // på klockan nu, vilket är fel för ett pass som läggs upp i förväg — och
    // starttiden styr både sortering och när loggen öppnar.
    const p = await openPassForObjekt(objektId, datum, tider.starttid)
    // Sluttiden från förra passet följer med — nästan alla pass på ett objekt
    // har samma tider, och utan sluttid vet appen inte när passet är slut.
    // Starttiden utelämnas medvetet: utelämnat betyder oförändrat.
    const slutTid = tider.sluttid || forra?.pass.sluttid
    const uppdaterat = slutTid ? await setPassTider(p.id, { sluttid: slutTid }) : p
    setPass(uppdaterat)
    setTider({ starttid: uppdaterat.starttid || '', sluttid: uppdaterat.sluttid || '' })
    setRoster(await rosterForPass(uppdaterat.id))
  })

  const kopiera = () => kor(async () => {
    const { lagda } = await kopieraBemanning(forra.pass.id, pass.id)
    if (!lagda) {
      setFel('Alla från förra passet står redan på det här passet.')
      return
    }
    setRoster(await rosterForPass(pass.id))
  })

  const sparaTider = () => kor(async () => {
    const p = await setPassTider(pass.id, tider)
    setPass(p)
    setTider({ starttid: p.starttid || '', sluttid: p.sluttid || '' })
  })

  const laggTill = (e) => {
    e.preventDefault()
    if (!nyRad.personalId) {
      setFel('Välj vem som ska läggas till på passet.')
      return
    }
    return kor(async () => {
      await setRosterEntry(pass.id, nyRad.personalId, nyRad)
      setRoster(await rosterForPass(pass.id))
      setNyRad(TOM_RAD)
    })
  }

  const taBort = (personalId) => kor(async () => {
    await removeRosterEntry(pass.id, personalId)
    setRoster(await rosterForPass(pass.id))
  })

  // Tider på en befintlig rad sparas när fältet lämnas, men bara om värdet
  // faktiskt ändrats — annars skulle varje tabb genom tabellen bli ett skriv.
  const sparaRad = (rad, falt, varde) => {
    if ((rad[falt] || '') === varde.trim()) return
    return kor(async () => {
      await setRosterEntry(pass.id, rad.personal_id, { ...rad, [falt]: varde.trim() || null })
      setRoster(await rosterForPass(pass.id))
    })
  }

  if (laddfel) return <div className="panel"><Feltillstand fel={laddfel} onForsokIgen={ladda} /></div>

  const last = pass && pass.status === 'skickat'
  const kvar = personal.filter((p) => !roster.some((r) => r.personal_id === p.id))
  const fonster = pass ? passFonster(pass) : null

  return (
    <div className="panel">
      <div className="h3">Bemanning</div>
      <div className="meta">
        Lägg upp passet och välj vilka som jobbar det. Bara bemannad personal kommer åt passloggen —
        objektkopplingen under Personal &amp; behörighet avgör bara vem som <em>får</em> bemannas här.
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="bem-objekt">Objekt</label>
          <select id="bem-objekt" value={objektId} onChange={(e) => setObjektId(e.target.value)}>
            {objekt.map((o) => <option key={o.id} value={o.id}>{o.namn}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bem-datum">Datum</label>
          <input id="bem-datum" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </div>
      </div>

      {pass === null ? (
        <div className="empty" style={{ marginTop: 16 }}>Laddar…</div>
      ) : pass === false ? (
        <div className="empty" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Inget pass upplagt för {datum}.</div>
          <div style={{ marginBottom: 14 }}>
            Ange när passet börjar — inläggen sorteras mot den tiden, så ett nattpass som
            startar 14:30 får inläggen efter midnatt sist i rapporten.
          </div>
          <div className="form-row" style={{ justifyContent: 'center' }}>
            <div className="field" style={{ maxWidth: 140 }}>
              <label htmlFor="bem-start-ny">Passet börjar</label>
              <input id="bem-start-ny" value={tider.starttid} placeholder="14:30"
                onChange={(e) => setTider({ ...tider, starttid: e.target.value })} />
            </div>
            <button className="btn primary" onClick={laggUppPass} disabled={busy || !tider.starttid.trim()}>
              {busy ? 'Lägger upp…' : 'Lägg upp passet'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mini-lbl" style={{ marginTop: 18 }}>Passets tider</div>
          <div className="form-row" style={{ marginTop: 0 }}>
            <div className="field" style={{ maxWidth: 130 }}>
              <label htmlFor="bem-start">Börjar</label>
              <input id="bem-start" value={tider.starttid} placeholder="14:30" disabled={last}
                onChange={(e) => setTider({ ...tider, starttid: e.target.value })} />
            </div>
            <div className="field" style={{ maxWidth: 130 }}>
              <label htmlFor="bem-slut">Slutar</label>
              <input id="bem-slut" value={tider.sluttid} placeholder="03:00" disabled={last}
                onChange={(e) => setTider({ ...tider, sluttid: e.target.value })} />
            </div>
            <button className="btn" onClick={sparaTider} disabled={busy || last}>Spara tider</button>
          </div>

          {/* Midnatt är den vanligaste källan till förvirring här: passet är
              daterat sin startdag, så ett pass 14:30–03:00 den 16:e slutar
              kl 03:00 den 17:e — men allt ligger kvar i 16:e:s rapport. */}
          {/* Adminpanelen är enda stället som läser passfönstret utan att först
              ha gått via arPassAktivt, så det är här ett otolkbart pass måste
              synas — annars är det tyst precis där det går att rätta. */}
          {fonster && !fonster.giltig && (
            <div className="err" role="alert" style={{ height: 'auto', margin: '4px 0 10px' }}>
              Passets tider går inte att tolka, så ingen kommer åt loggen. Skriv dem som HH:MM och spara.
            </div>
          )}
          {fonster?.giltig && fonster.overMidnatt && (
            <div className="inc-hint">
              Går över midnatt: börjar {pass.starttid} den {pass.datum} och slutar {pass.sluttid} dagen efter.
              Allt hamnar i samma rapport, daterad {pass.datum}.
            </div>
          )}
          {fonster?.giltig && fonster.oppetSlut && (
            <div className="inc-hint">
              Ingen sluttid satt — passet räknas som öppet ett dygn från starten. Sätt sluttiden,
              så vet appen när loggen ska stängas för personalen.
            </div>
          )}

          <div className="mini-lbl" style={{ marginTop: 20 }}>
            På passet ({roster.length})
            {last && <span className="pill sent" style={{ marginLeft: 8 }}>Låst</span>}
          </div>

          {!last && forra && (
            <div className="form-row" style={{ marginTop: 0, marginBottom: 12 }}>
              <button className="btn" onClick={kopiera} disabled={busy}>
                Kopiera bemanning från {forra.pass.datum} ({forra.roster.length} pers.)
              </button>
            </div>
          )}

          {roster.length === 0 ? (
            <div className="empty">
              Ingen är bemannad ännu. Ingen kommer åt passloggen förrän någon läggs till här.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr><th>Sign.</th><th>Namn</th><th>Roll</th><th>In</th><th>Ut</th><th /></tr>
                </thead>
                <tbody>
                  {roster.map((r) => (
                    <tr key={r.personal_id}>
                      <td><span className="avatar">{r.initialer?.slice(0, 2)}</span></td>
                      <td style={{ fontWeight: 700 }}>{r.namn}</td>
                      <td>
                        <select value={r.roll || ''} disabled={last || busy} aria-label={`Roll för ${r.namn}`}
                          onChange={(e) => sparaRad(r, 'roll', e.target.value)}>
                          {ROLES.map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="tid-cell" defaultValue={r.tid_in || ''} placeholder="—" disabled={last || busy}
                          aria-label={`Tid in för ${r.namn}`}
                          onBlur={(e) => sparaRad(r, 'tid_in', e.target.value)} />
                      </td>
                      <td>
                        <input className="tid-cell" defaultValue={r.tid_ut || ''} placeholder="—" disabled={last || busy}
                          aria-label={`Tid ut för ${r.namn}`}
                          onBlur={(e) => sparaRad(r, 'tid_ut', e.target.value)} />
                      </td>
                      <td>
                        <button className="linkbtn" disabled={last || busy}
                          onClick={() => taBort(r.personal_id)}>Ta bort</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!last && (
            <>
              <div className="mini-lbl" style={{ marginTop: 20 }}>Lägg till på passet</div>
              {kvar.length === 0 ? (
                <div className="empty">
                  All personal som är kopplad till objektet står redan på passet. Koppla fler under
                  Personal &amp; behörighet.
                </div>
              ) : (
                <form className="form-row" onSubmit={laggTill}>
                  <div className="field">
                    <label htmlFor="bem-person">Person</label>
                    <select id="bem-person" value={nyRad.personalId}
                      onChange={(e) => {
                        const vald = personal.find((p) => p.id === e.target.value)
                        // Rollen förifylls från personalregistret men går att
                        // ändra — en värd kan gå som ordningsvakt ett pass.
                        setNyRad({ ...nyRad, personalId: e.target.value, roll: vald?.roll || nyRad.roll })
                      }}>
                      <option value="">Välj…</option>
                      {kvar.map((p) => <option key={p.id} value={p.id}>{p.namn} ({p.initialer})</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="bem-roll">Roll</label>
                    <select id="bem-roll" value={nyRad.roll} onChange={(e) => setNyRad({ ...nyRad, roll: e.target.value })}>
                      {ROLES.map((v) => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ maxWidth: 110 }}>
                    <label htmlFor="bem-in">In</label>
                    <input id="bem-in" value={nyRad.tid_in} placeholder="14:30"
                      onChange={(e) => setNyRad({ ...nyRad, tid_in: e.target.value })} />
                  </div>
                  <div className="field" style={{ maxWidth: 110 }}>
                    <label htmlFor="bem-ut">Ut</label>
                    <input id="bem-ut" value={nyRad.tid_ut} placeholder="23:30"
                      onChange={(e) => setNyRad({ ...nyRad, tid_ut: e.target.value })} />
                  </div>
                  <button className="btn primary" type="submit" disabled={busy}>
                    {busy ? 'Sparar…' : 'Lägg till'}
                  </button>
                </form>
              )}
            </>
          )}
        </>
      )}

      {fel && <div className="err" role="alert" style={{ height: 'auto', marginTop: 12 }}>{fel}</div>}
    </div>
  )
}
