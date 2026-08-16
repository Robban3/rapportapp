import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { objectsForStaff, aktivtPassForStaff, entriesForPass, addEntry, INCIDENT_TYPES } from '../lib/api.js'
import { useSession } from '../state/session.jsx'
import { nowHHMM, normalizeTid, passFonster } from '../lib/time.js'
import { felText } from '../lib/errors.js'
import Feltillstand from '../components/Feltillstand.jsx'

const POLL_MS = 15000

export default function ShiftLog() {
  const { objektId } = useParams()
  const { staff } = useSession()

  // Laddning, behörighet och fel är olika tillstånd. Tidigare användes
  // null som både "laddar" och "hittades inte", så alla fick en
  // behörighetsvarning att blinka förbi vid varje sidladdning.
  //
  // `obehorig`, `inget_pass` och `ej_bemannad` hålls isär eftersom de kräver
  // olika åtgärd av värden: be om objektbehörighet, vänta på att passet läggs
  // upp, respektive be om att bli bemannad på just den här dagen.
  const [status, setStatus] = useState('laddar') // laddar | klar | obehorig | inget_pass | ej_bemannad | fel
  const [laddfel, setLaddfel] = useState(null)
  const [objekt, setObjekt] = useState(null)
  const [pass, setPass] = useState(null)

  const [entries, setEntries] = useState([])
  const [tid, setTid] = useState(nowHHMM())
  const [msg, setMsg] = useState('')
  const [inc, setInc] = useState(null)
  const [busy, setBusy] = useState(false)
  const [skrivfel, setSkrivfel] = useState('')
  const bottom = useRef(null)

  const ladda = useCallback(async () => {
    setStatus('laddar')
    setLaddfel(null)
    try {
      const mina = await objectsForStaff(staff.id)
      const hittat = mina.find((o) => o.id === objektId)

      // Objektbehörigheten kontrolleras först. Den säger bara att personen
      // FÅR bemannas här — bemanningen på dagens pass avgör resten.
      if (!hittat) {
        setStatus('obehorig')
        return
      }

      setObjekt(hittat)

      // Passet skapas aldrig härifrån. Admin lägger upp det under Bemanning,
      // annars kunde vem som helst med objektbehörighet öppna ett pass hen
      // inte är bemannad på och börja skriva i det.
      //
      // Vilket pass det blir avgörs av passets egna tider, inte av dagens
      // datum: kl 02:00 är det gårdagens pass som pågår.
      const { pass: dagensPass, bemannad } = await aktivtPassForStaff(staff.id, objektId)
      if (!dagensPass) {
        setStatus('inget_pass')
        return
      }
      if (!bemannad) {
        // Passet sätts medvetet inte — då startar inte pollningen, och
        // inlägg hämtas aldrig för någon som inte får läsa dem.
        setStatus('ej_bemannad')
        return
      }

      setPass(dagensPass)
      setStatus('klar')
    } catch (fel) {
      setLaddfel(fel)
      setStatus('fel')
    }
  }, [objektId, staff.id])

  useEffect(() => { ladda() }, [ladda])

  // Hämta inlägg och polla för kollegornas inlägg. Pausar när fliken är dold
  // eller enheten är offline — tidigare gick det 720 anrop i timmen per
  // enhet oavsett om någon tittade.
  useEffect(() => {
    if (!pass) return
    let levande = true

    const load = () => {
      if (document.hidden || !navigator.onLine) return
      entriesForPass(pass.id)
        .then((e) => { if (levande) setEntries(e) })
        .catch(() => { /* tyst: nästa poll försöker igen, inget går förlorat */ })
    }

    load()
    const iv = setInterval(load, POLL_MS)
    document.addEventListener('visibilitychange', load)
    window.addEventListener('online', load)
    window.addEventListener('focus', load)

    return () => {
      levande = false
      clearInterval(iv)
      document.removeEventListener('visibilitychange', load)
      window.removeEventListener('online', load)
      window.removeEventListener('focus', load)
    }
  }, [pass])

  async function send() {
    if (!msg.trim() || !pass || busy) return

    if (!normalizeTid(tid)) {
      setSkrivfel('Tiden går inte att tolka. Skriv den som HH:MM, t.ex. 21:05.')
      return
    }

    setBusy(true)
    setSkrivfel('')
    try {
      await addEntry({
        passId: pass.id, personalId: staff.id, tid,
        meddelande: msg.trim(), incidentTyp: inc,
        passStartTid: pass.starttid
      })
      // Rensa först när inlägget faktiskt är sparat.
      setMsg(''); setInc(null); setTid(nowHHMM())
      setEntries(await entriesForPass(pass.id))
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }))
    } catch (fel) {
      // Texten står kvar i fältet så värden slipper skriva om den.
      setSkrivfel(felText(fel))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'laddar') return <div className="empty">Laddar passet…</div>
  if (status === 'fel') return <Feltillstand fel={laddfel} onForsokIgen={ladda} />
  if (status === 'obehorig') {
    return <div className="empty">Du har inte behörighet till det här objektet. Be en administratör koppla dig.</div>
  }
  if (status === 'inget_pass') {
    return (
      <div className="empty">
        Inget pass pågår just nu på {objekt?.namn}.
        <div style={{ marginTop: 6 }}>En administratör lägger upp och bemannar passet under Bemanning.</div>
      </div>
    )
  }
  if (status === 'ej_bemannad') {
    return (
      <div className="empty">
        Du är inte bemannad på passet som pågår på {objekt?.namn}.
        <div style={{ marginTop: 6 }}>Be en administratör lägga till dig på passet, så ser du loggen.</div>
      </div>
    )
  }

  const fonster = passFonster(pass)
  const last = pass.status === 'skickat'

  return (
    <div>
      <div className="shift-head">
        <span className="obj-ico">{objekt.namn.split(' ').slice(0, 2).map((w) => w[0]).join('')}</span>
        <div>
          <div className="obj-name">{objekt.namn}<span className="role-tag">{staff.roll}</span></div>
          {/* Datumet är passets STARTDAG. Kl 02:00 står det alltså gårdagens
              datum här, och det är meningen — annars tror värden att hen
              skriver i fel pass. */}
          <div className="obj-sub">
            Pass {pass.datum} · {pass.starttid}–{pass.sluttid || 'pågår'}
            {fonster.overMidnatt && <span className="natt-tag">över midnatt</span>}
            {' '}· signerar som {staff.initialer}
          </div>
        </div>
      </div>

      <div className="log-meta">Passlogg · {entries.length} inlägg</div>
      <div className="entries" aria-live="polite">
        {entries.length === 0 && <div className="empty">Inget skrivet i passet ännu.</div>}
        {entries.map((e) => {
          const it = INCIDENT_TYPES.find((t) => t.key === e.incident_typ)
          return (
            <div key={e.id} className={'entry' + (e.personal_id === staff.id ? ' mine' : '')}>
              <div className="t">{e.tid}</div>
              <div className="body">
                <div className="msg">{e.meddelande}</div>
                <div className="sig">
                  <span className="av">{e.signatur?.slice(0, 2)}</span>{e.signatur}
                  {it && <span className="inc-badge">{it.kort}</span>}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      {/* En låst rapport får inte kunna växa. Tidigare gick det att skriva
          vidare i ett pass admin redan skickat till kund. */}
      {last ? (
        <div className="empty" style={{ marginTop: 14 }}>
          Passet är låst och rapporten skickad. Rättelser läggs till av en administratör.
        </div>
      ) : (
      <div className="composer">
        <div className="composer-inner">
          <div className="crow">
            <input className="tinput" value={tid} onChange={(e) => setTid(e.target.value)}
              inputMode="numeric" aria-label="Tid" />
            <input className="minput" value={msg} placeholder="Skriv fritt inlägg…" aria-label="Inlägg"
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button className="send" onClick={send} disabled={busy || !msg.trim()}
              aria-label="Spara inlägg">→</button>
          </div>
          {skrivfel && (
            <div className="err" role="alert" style={{ height: 'auto', marginTop: 8 }}>{skrivfel}</div>
          )}
          <div className="inc-row">
            {INCIDENT_TYPES.map((t) => (
              <button key={t.key} className={'inc-chip' + (inc === t.key ? ' on' : '')}
                aria-pressed={inc === t.key}
                onClick={() => setInc(inc === t.key ? null : t.key)}>{t.kort}</button>
            ))}
          </div>
          <div className="inc-hint">
            Tid förifylls automatiskt · går att ändra · stöder intervall (t.ex. 20:45-21:30).
            Tagga valfritt en incident så räknas statistiken automatiskt.
            {fonster.overMidnatt && ' Passet går över midnatt — skriv klockslaget som det står på klockan, appen lägger inlägget rätt ändå.'}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
