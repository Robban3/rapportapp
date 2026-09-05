import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { report, lockAndSend, INCIDENT_TYPES } from '../../lib/api.js'
import { felText } from '../../lib/errors.js'
import Feltillstand from '../../components/Feltillstand.jsx'

export default function ReportDetail() {
  const { passId } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [laddfel, setLaddfel] = useState(null)
  const [mottagare, setMottagare] = useState([])
  const [kvitto, setKvitto] = useState(null)   // { mottagare, utskickat } efter lyckat utskick
  const [omskickar, setOmskickar] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sandfel, setSandfel] = useState('')
  const [bekraftar, setBekraftar] = useState(false)

  const ladda = useCallback(() => {
    setLaddfel(null)
    setData(null)
    report(passId)
      .then((r) => { setData(r); setMottagare(r.objekt?.rapportmottagare || []) })
      .catch(setLaddfel)
  }, [passId])

  useEffect(() => { ladda() }, [ladda])

  // Escape stänger bekräftelserutan. Klick utanför gör det medvetet INTE —
  // låsningen är oåterkallelig och ska inte kunna avbrytas av en slinttryckning.
  useEffect(() => {
    if (!bekraftar) return
    const onKey = (e) => { if (e.key === 'Escape' && !busy) setBekraftar(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bekraftar, busy])

  async function send(omskick = false) {
    setBusy(true)
    setSandfel('')
    try {
      const svar = await lockAndSend(passId, { omskick })
      setKvitto(svar)
      setBekraftar(false)
      setOmskickar(false)
    } catch (fel) {
      // Passet kan vara låst även när mejlet inte gick iväg — det står i
      // felmeddelandet från servern. Rapporten hämtas om så statusen stämmer.
      setSandfel(felText(fel))
      setBekraftar(false)
      setOmskickar(false)
      ladda()
    } finally {
      setBusy(false)
    }
  }

  if (laddfel) return <div className="panel"><Feltillstand fel={laddfel} onForsokIgen={ladda} /></div>
  if (!data) return <div className="panel"><div className="empty">Laddar…</div></div>

  const { objekt, pass, roster, entries, stats } = data
  // Låst och skickat är två olika saker. Ett pass kan vara stängt för nya
  // inlägg utan att rapporten nått kunden — och då ska det synas, även efter
  // att administratören laddat om sidan.
  // `kvitto` finns direkt efter ett utskick i den här sessionen; passet i
  // `data` är då fortfarande det som hämtades före låsningen.
  const last = Boolean(kvitto) || pass.status === 'last' || pass.status === 'skickat'
  const levererad = kvitto ? kvitto.utskickat : pass.status === 'skickat'
  // Rättelser räknas för sig. Kunden ska se att t.ex. 12 inlägg innehåller
  // 2 rättelser, inte tro att det skrivits 12 fristående anteckningar.
  const antalRattelser = entries.filter((e) => e.rattar_id).length

  return (
    <div className="review-grid">
      <div className="panel" id="report">
        <div>
          <span className="h3">{objekt?.namn}</span>
          <span className={'pill ' + (levererad ? 'sent' : last ? 'fara' : 'review')}>
            {levererad ? 'Skickad' : last ? 'Låst — ej skickad' : 'Granskas'}
          </span>
        </div>
        <div className="meta">
          {pass.datum} · pass {pass.starttid}–{pass.sluttid || '—'} · {roster.length} i personalen
          {' '}· {entries.length} inlägg
          {antalRattelser > 0 && ` (varav ${antalRattelser} ${antalRattelser === 1 ? 'rättelse' : 'rättelser'})`}
          {' '}· automatiskt sorterat i tidsordning
        </div>

        <div className="mini-lbl">Personal på passet</div>
        {roster.length === 0 ? (
          <div className="empty" style={{ marginBottom: 16 }}>Ingen personal är registrerad på passet ännu.</div>
        ) : (
          <div className="roster">
            {roster.map((r) => (
              <div className="rchip" key={r.personal_id}>
                <span className="av">{r.initialer?.slice(0, 2)}</span>
                <div>
                  <div>{r.initialer} <span className="rr">{r.roll}</span></div>
                  <div className="tt">{r.tid_in}–{r.tid_ut}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mini-lbl">Anteckningar</div>
        {/* Ett rättat inlägg tas aldrig bort ur rapporten. Det står kvar
            överstruket med rättelsen direkt under, så kunden ser både vad som
            först skrevs och vad som gäller. entriesForPass har redan lagt dem
            i den ordningen. */}
        <div className="rep">
          {entries.map((e) => (
            <div className={'rrow' + (e.ar_rattad ? ' rattad' : '') + (e.rattar_id ? ' rattelse' : '')} key={e.id}>
              <div className="rt">{e.tid}</div>
              <div>
                <span className="rmsg">{e.meddelande}</span>
                <div className="rn">
                  {e.signatur}
                  {e.rattar_id && <span className="ratt-badge">Rättelse</span>}
                  {e.ar_rattad && <span className="ratt-badge gammal">Rättad</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="panel">
          <div className="mini-lbl">Statistik</div>
          <p className="stat-hint">Räknas automatiskt från inlägg som taggats med en incidenttyp.</p>
          {INCIDENT_TYPES.map((t) => (
            <div className="stat" key={t.key}><span className="num">{stats[t.key] || 0}</span>{t.kort}</div>
          ))}

          {/* Mottagarna hör till objektet, inte till det enskilda passet, och
              redigeras därför under Objekt. Ett fritt fält här hade gjort det
              oklart vilken adress som faktiskt gäller. */}
          <div className="field">
            {/* Ingen kontroll att peka på — mottagarna är läsning här och
                redigeras under Objekt. Därför mini-lbl och inte label. */}
            <div className="mini-lbl" style={{ marginBottom: 5 }}>Rapporten skickas till</div>
            {mottagare.length === 0 ? (
              <div className="err" role="alert" style={{ height: 'auto' }}>
                Objektet saknar mottagare. Lägg till under Objekt innan du låser.
              </div>
            ) : (
              <div className="mott-lista">{mottagare.map((m) => <span className="mott" key={m}>{m}</span>)}</div>
            )}
          </div>

          {last ? (
            <div className="empty">
              <div style={{ color: levererad ? 'var(--accent)' : 'var(--alert)', fontWeight: 700, marginBottom: 6 }}>
                {levererad ? 'Rapporten är skickad.' : 'Låst, men inte skickad.'}
              </div>
              <div>
                {levererad
                  ? `Mejlad till ${(kvitto?.mottagare || mottagare).join(', ')}.`
                  : kvitto?.demolage
                    ? 'Demoläget skickar ingen e-post. I skarp drift mejlas rapporten till mottagarna.'
                    : 'Loggen är stängd, men mejlet gick inte fram. Kunden har inte fått rapporten.'}
              </div>
              {/* Orsaken kommer från databasen, inte från ett React-state —
                  den överlever att fliken stängs. */}
              {!levererad && pass.utskick_fel && (
                <div className="err" role="alert" style={{ height: 'auto', marginTop: 10, textAlign: 'left' }}>
                  {pass.utskick_fel}
                </div>
              )}
              {/* Ett omskick är ett aktivt val: dubbelklick ska inte kunna ge
                  kunden samma rapport två gånger. */}
              <button className="btn block" style={{ marginTop: 12 }}
                onClick={() => setOmskickar(true)} disabled={busy || mottagare.length === 0}>
                {levererad ? 'Skicka om' : 'Försök skicka igen'}
              </button>
            </div>
          ) : (
            <>
              <button className="btn primary block" onClick={() => setBekraftar(true)}
                disabled={busy || mottagare.length === 0}>Lås och skicka rapporten</button>
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => window.print()}>Förhandsgranska / skriv ut</button>
            </>
          )}
          {sandfel && <div className="err" role="alert" style={{ height: 'auto', marginTop: 10 }}>{sandfel}</div>}
          <button className="btn block" style={{ marginTop: 8 }} onClick={() => nav('/admin')}>← Tillbaka</button>
        </div>
      </div>

      {omskickar && (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="omskick-rubrik">
            <h3 id="omskick-rubrik">Skicka om rapporten?</h3>
            <div className="sub">
              Samma rapport mejlas igen till {mottagare.join(', ')}. Använd det om utskicket
              fastnade — annars får kunden den två gånger.
            </div>
            <div className="row-end">
              <button className="btn" onClick={() => setOmskickar(false)} disabled={busy}>Avbryt</button>
              <button className="btn primary" onClick={() => send(true)} disabled={busy}>
                {busy ? 'Skickar…' : 'Skicka om'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bekraftar && (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="las-rubrik">
            <h3 id="las-rubrik">Lås och skicka rapporten</h3>
            <div className="sub">
              Passet låses och rapporten mejlas till mottagarna. Efter det går den inte att
              ändra — en rättelse blir en ny rad i nästa utskick.
            </div>
            <div className="rep" style={{ marginTop: 12 }}>
              <div className="rrow"><div className="rt">Objekt</div><div>{objekt?.namn}</div></div>
              <div className="rrow"><div className="rt">Pass</div><div>{pass.datum} · {pass.starttid}–{pass.sluttid || '—'}</div></div>
              <div className="rrow"><div className="rt">Inlägg</div><div>{entries.length} st · {roster.length} i personalen</div></div>
              <div className="rrow"><div className="rt">Till</div><div>{mottagare.join(', ')}</div></div>
            </div>
            <div className="row-end">
              <button className="btn" onClick={() => setBekraftar(false)} disabled={busy}>Avbryt</button>
              <button className="btn primary" onClick={() => send(false)} disabled={busy}>
                {busy ? 'Skickar…' : 'Lås och skicka'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
