import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { objectsForStaff, aktivtPassForStaff, passById, entriesForPass, addEntry, INCIDENT_TYPES } from '../lib/api.js'
import { useSession } from '../state/sessionCtx.js'
import { nowHHMM, normalizeTid, passFonster } from '../lib/time.js'
import { felText } from '../lib/errors.js'
import { koFor, laggIKo, taBortFranKo, forsokIgen, flusha, arNatverksfel } from '../lib/utkorg.js'
import { lyssnaPaPass } from '../lib/realtid.js'
import Feltillstand from '../components/Feltillstand.jsx'

// Utan realtid pollas loggen var 15:e sekund. Med realtid uppe räcker en
// gles kontroll — den finns kvar som skyddsnät ifall WebSocketen tappas
// utan att säga till.
const POLL_MS = 15000
const POLL_SAKERHET_MS = 60000

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
  // Vilket inlägg som rättas, eller null för ett vanligt inlägg.
  const [rattar, setRattar] = useState(null)
  const [busy, setBusy] = useState(false)
  const [skrivfel, setSkrivfel] = useState('')
  // Inlägg som skrivits utan nät och ännu inte kommit fram.
  const [ko, setKo] = useState([])
  // Är realtidsprenumerationen uppe? Styr hur tätt appen pollar.
  const [realtid, setRealtid] = useState(false)
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
  //
  // Passet hämtas om i samma svep. Tidigare lästes det bara vid sidladdning,
  // så en rapport som admin låste mitt i passet lämnade skrivfältet aktivt
  // och inläggen fortsatte fylla på en redan skickad rapport.
  const passId = pass?.id

  // Vilket pass som är aktuellt just nu. Byter värden objekt mitt i en
  // hämtning ska det gamla svaret inte skriva över den nya loggen.
  const aktuelltPass = useRef(passId)
  useEffect(() => { aktuelltPass.current = passId }, [passId])

  const hamta = useCallback(async () => {
    if (!passId || document.hidden || !navigator.onLine) return

    // Utkorgen töms först. Annars hämtas loggen, de köade inläggen skickas
    // strax därefter, och värden ser dem inte förrän nästa hämtning.
    try {
      await flusha(staff.id, addEntry)
    } catch { /* flusha markerar själv vad som inte gick fram */ }
    if (aktuelltPass.current !== passId) return
    setKo(koFor(staff.id, passId))

    try {
      const farskt = await passById(passId)
      if (farskt && aktuelltPass.current === passId) setPass(farskt)
    } catch { /* tyst: nästa hämtning försöker igen */ }

    try {
      const rader = await entriesForPass(passId)
      if (aktuelltPass.current === passId) setEntries(rader)
    } catch { /* tyst: nästa hämtning försöker igen, inget går förlorat */ }
  }, [passId, staff.id])

  // Realtid: kollegans inlägg dyker upp direkt i stället för vid nästa poll,
  // och skrivfältet stängs i samma stund som admin låser rapporten.
  //
  // Händelsen bär bara signalen "något ändrades" — loggen hämtas om. Raden i
  // händelsen saknar signatur och rättelsemarkering, och en halvfärdig rad i
  // loggen är värre än en hämtning till.
  useEffect(() => {
    if (!passId) return

    // Två värdar som skriver samtidigt ger två händelser. Utan den här
    // pausen blir det två hämtningar på samma millisekund.
    let timer = null
    const strax = () => { clearTimeout(timer); timer = setTimeout(hamta, 150) }

    const avsluta = lyssnaPaPass(passId, { onAndring: strax, onStatus: setRealtid })
    return () => { clearTimeout(timer); avsluta() }
  }, [passId, hamta])

  // Pollningen ligger kvar. Realtid som tappas tyst — sovande telefon, tappat
  // nät, proxy som stänger WebSockets — får inte betyda att loggen fryser.
  useEffect(() => {
    if (!passId) return

    // Kön visas direkt, även offline när hamta() inte gör något.
    setKo(koFor(staff.id, passId))

    hamta()
    const iv = setInterval(hamta, realtid ? POLL_SAKERHET_MS : POLL_MS)
    document.addEventListener('visibilitychange', hamta)
    window.addEventListener('online', hamta)
    window.addEventListener('focus', hamta)

    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', hamta)
      window.removeEventListener('online', hamta)
      window.removeEventListener('focus', hamta)
    }
  }, [passId, staff.id, hamta, realtid])

  function rullaNed() {
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }))
  }

  function rensaFalt() {
    setMsg(''); setInc(null); setTid(nowHHMM()); setRattar(null)
  }

  async function send() {
    if (!msg.trim() || !pass || busy) return

    if (!normalizeTid(tid)) {
      setSkrivfel('Tiden går inte att tolka. Skriv den som HH:MM, t.ex. 21:05.')
      return
    }

    const post = {
      passId: pass.id, personalId: staff.id, tid,
      meddelande: msg.trim(), incidentTyp: inc,
      passStartTid: pass.starttid,
      rattarId: rattar?.id ?? null
    }

    setBusy(true)
    setSkrivfel('')

    // Källarplan, garage och hisschakt. Utan nät går inlägget i utkorgen med
    // en gång — det är snabbare än att vänta ut en timeout, och texten är
    // kvar även om appen stängs.
    if (!navigator.onLine) {
      koa(post)
      setBusy(false)
      return
    }

    try {
      await addEntry(post)
      // Rensa först när inlägget faktiskt är sparat.
      rensaFalt()
      setEntries(await entriesForPass(pass.id))
      rullaNed()
    } catch (fel) {
      // Nätet försvann mitt i: inlägget köas i stället för att gå förlorat.
      // Ett nekat inlägg (låst pass, fel behörighet) köas däremot inte —
      // det blir inte rätt av att skickas om.
      if (arNatverksfel(fel)) koa(post)
      // Texten står kvar i fältet så värden slipper skriva om den.
      else setSkrivfel(felText(fel))
    } finally {
      setBusy(false)
    }
  }

  function koa(post) {
    laggIKo(post)
    setKo(koFor(staff.id, pass.id))
    rensaFalt()
    rullaNed()
  }

  function slangKoat(id) {
    taBortFranKo(id)
    setKo(koFor(staff.id, pass.id))
  }

  async function skickaOm(id) {
    forsokIgen(id)
    setKo(koFor(staff.id, pass.id))
    await flusha(staff.id, addEntry)
    setKo(koFor(staff.id, pass.id))
    try { setEntries(await entriesForPass(pass.id)) } catch { /* nästa poll hämtar */ }
  }

  function borjaRatta(e) {
    setRattar(e)
    setTid(e.tid)
    setMsg(e.meddelande)
    setInc(e.incident_typ || null)
    setSkrivfel('')
    requestAnimationFrame(() => document.querySelector('.minput')?.focus())
  }

  function avbrytRattelse() {
    setRattar(null)
    setMsg(''); setInc(null); setTid(nowHHMM())
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

      {/* Objektspecifik information som värden annars måste minnas eller
          ringa efter. Ligger ovanför loggen, inte i den, så den inte hamnar
          i rapporten till kund. */}
      {(objekt.instruktioner || objekt.kontaktperson) && (
        <div className="objekt-info">
          {objekt.instruktioner && <div className="oi-text">{objekt.instruktioner}</div>}
          {objekt.kontaktperson && (
            <div className="oi-kontakt">
              Kontakt: <b>{objekt.kontaktperson}</b>
              {objekt.kontakt_telefon && <> · <a href={`tel:${objekt.kontakt_telefon.replace(/\s/g, '')}`}>{objekt.kontakt_telefon}</a></>}
            </div>
          )}
        </div>
      )}

      <div className="log-meta">
        Passlogg · {entries.length} inlägg
        {realtid && <span className="rt-tag" title="Kollegornas inlägg syns direkt">direkt</span>}
        {ko.length > 0 && <span className="ko-rakning">{ko.length} väntar på nät</span>}
      </div>
      <div className="entries" aria-live="polite">
        {entries.length === 0 && <div className="empty">Inget skrivet i passet ännu.</div>}
        {entries.map((e) => {
          const it = INCIDENT_TYPES.find((t) => t.key === e.incident_typ)
          return (
            <div key={e.id} className={'entry'
              + (e.personal_id === staff.id ? ' mine' : '')
              + (e.ar_rattad ? ' rattad' : '')
              + (e.rattar_id ? ' rattelse' : '')}>
              <div className="t">{e.tid}</div>
              <div className="body">
                <div className="msg">{e.meddelande}</div>
                <div className="sig">
                  <span className="av">{e.signatur?.slice(0, 2)}</span>{e.signatur}
                  {e.rattar_id && <span className="ratt-badge">Rättelse</span>}
                  {e.ar_rattad && <span className="ratt-badge gammal">Rättad</span>}
                  {it && <span className="inc-badge">{it.kort}</span>}
                  {/* Rättelser skrivs bara i ett öppet pass, och ett inlägg
                      rättas en gång — resten stoppas ändå av databasen. */}
                  {!last && !e.ar_rattad && !e.rattar_id && !ko.some((k) => k.rattarId === e.id) && (
                    <button className="linkbtn ratta-knapp" onClick={() => borjaRatta(e)}>Rätta</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* Köade inlägg ligger sist och är tydligt märkta. De hamnar på rätt
            plats i tidsordningen först när de kommit fram — det är servern som
            äger loggen, inte telefonen. */}
        {ko.map((k) => (
          <div key={k.id} className={'entry mine koad' + (k.fel ? ' koad-fel' : '')}>
            <div className="t">{k.tid}</div>
            <div className="body">
              <div className="msg">{k.meddelande}</div>
              {k.fel && <div className="ko-fel">{k.fel}</div>}
              <div className="sig">
                <span className="av">{staff.initialer?.slice(0, 2)}</span>{staff.initialer}
                {k.rattarId && <span className="ratt-badge">Rättelse</span>}
                <span className={'ko-badge' + (k.fel ? ' fel' : '')}>
                  {k.fel ? 'Kom inte fram' : 'Väntar på nät'}
                </span>
                {k.fel && (
                  <>
                    <button className="linkbtn" onClick={() => skickaOm(k.id)}>Försök igen</button>
                    <button className="linkbtn" onClick={() => slangKoat(k.id)}>Ta bort</button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
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
          {rattar && (
            <div className="rattar-rad">
              Rättar inlägget <b>{rattar.tid}</b> av {rattar.signatur}. Originalet står kvar
              i rapporten, överstruket.
              <button className="linkbtn" onClick={avbrytRattelse}>Avbryt</button>
            </div>
          )}
          <div className="crow">
            <input className="tinput" value={tid} onChange={(e) => setTid(e.target.value)}
              inputMode="numeric" aria-label="Tid" />
            <input className="minput" value={msg} placeholder="Skriv fritt inlägg…" aria-label="Inlägg"
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button className="send" onClick={send} disabled={busy || !msg.trim()}
              aria-label={rattar ? 'Spara rättelse' : 'Spara inlägg'}>→</button>
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
