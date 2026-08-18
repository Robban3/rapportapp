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
  const [sent, setSent] = useState(false)
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

  async function send() {
    setBusy(true)
    setSandfel('')
    try {
      await lockAndSend(passId, mottagare)
      setSent(true)
      setBekraftar(false)
    } catch (fel) {
      setSandfel(felText(fel))
    } finally {
      setBusy(false)
    }
  }

  if (laddfel) return <div className="panel"><Feltillstand fel={laddfel} onForsokIgen={ladda} /></div>
  if (!data) return <div className="panel"><div className="empty">Laddar…</div></div>

  const { objekt, pass, roster, entries, stats } = data
  const isSent = sent || pass.status === 'skickat'
  // Rättelser räknas för sig. Kunden ska se att t.ex. 12 inlägg innehåller
  // 2 rättelser, inte tro att det skrivits 12 fristående anteckningar.
  const antalRattelser = entries.filter((e) => e.rattar_id).length

  return (
    <div className="review-grid">
      <div className="panel" id="report">
        <div>
          <span className="h3">{objekt?.namn}</span>
          <span className={'pill ' + (isSent ? 'sent' : 'review')}>{isSent ? 'Låst' : 'Granskas'}</span>
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

          {isSent ? (
            // Ingen PDF genereras och inget mejl skickas ännu (Fas 1.2), så
            // rapporten får inte påstå att den gjort det.
            <div className="empty">
              <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 6 }}>Rapporten är låst.</div>
              <div>
                Utskicket till {mottagare.length ? mottagare.join(', ') : 'kunden'} sker manuellt
                tills automatiken är på plats.
              </div>
            </div>
          ) : (
            <>
              <button className="btn primary block" onClick={() => setBekraftar(true)}
                disabled={busy || mottagare.length === 0}>Lås rapporten</button>
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => window.print()}>Förhandsgranska / skriv ut</button>
            </>
          )}
          {sandfel && <div className="err" role="alert" style={{ height: 'auto', marginTop: 10 }}>{sandfel}</div>}
          <button className="btn block" style={{ marginTop: 8 }} onClick={() => nav('/admin')}>← Tillbaka</button>
        </div>
      </div>

      {bekraftar && (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="las-rubrik">
            <h3 id="las-rubrik">Lås rapporten</h3>
            <div className="sub">Efter låsning går rapporten inte att ändra. Rättelser måste läggas till som nya rader.</div>
            <div className="rep" style={{ marginTop: 12 }}>
              <div className="rrow"><div className="rt">Objekt</div><div>{objekt?.namn}</div></div>
              <div className="rrow"><div className="rt">Pass</div><div>{pass.datum} · {pass.starttid}–{pass.sluttid || '—'}</div></div>
              <div className="rrow"><div className="rt">Inlägg</div><div>{entries.length} st · {roster.length} i personalen</div></div>
              <div className="rrow"><div className="rt">Till</div><div>{mottagare.join(', ')}</div></div>
            </div>
            <div className="row-end">
              <button className="btn" onClick={() => setBekraftar(false)} disabled={busy}>Avbryt</button>
              <button className="btn primary" onClick={send} disabled={busy}>
                {busy ? 'Låser…' : 'Lås rapporten'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
