import { useCallback, useEffect, useState } from 'react'
import { listObjects, addObject, updateObject, setObjectAktiv } from '../../lib/api.js'
import { felText } from '../../lib/errors.js'
import Feltillstand from '../../components/Feltillstand.jsx'
import Sidhuvud from '../../components/Sidhuvud.jsx'

const TOM_FORM = {
  namn: '', kod: '', rapportmottagare: [''],
  standard_starttid: '', standard_sluttid: '',
  kontaktperson: '', kontakt_telefon: '', instruktioner: ''
}

// Databasen sparar null för tomma fält; formuläret vill ha strängar.
const tillForm = (o) => ({
  namn: o.namn || '', kod: o.kod || '',
  rapportmottagare: o.rapportmottagare?.length ? [...o.rapportmottagare] : [''],
  standard_starttid: o.standard_starttid || '', standard_sluttid: o.standard_sluttid || '',
  kontaktperson: o.kontaktperson || '', kontakt_telefon: o.kontakt_telefon || '',
  instruktioner: o.instruktioner || ''
})

export default function Objekt() {
  const [objekt, setObjekt] = useState(null)
  const [visaInaktiva, setVisaInaktiva] = useState(false)
  const [laddfel, setLaddfel] = useState(null)
  const [redigerar, setRedigerar] = useState(null)   // objekt-id, eller 'nytt'
  const [form, setForm] = useState(TOM_FORM)
  const [fel, setFel] = useState('')
  const [busy, setBusy] = useState(false)

  const ladda = useCallback(async () => {
    setLaddfel(null)
    try { setObjekt(await listObjects({ inklInaktiva: true })) } catch (f) { setLaddfel(f) }
  }, [])

  useEffect(() => { ladda() }, [ladda])

  function borja(o) {
    setFel('')
    setRedigerar(o ? o.id : 'nytt')
    setForm(o ? tillForm(o) : TOM_FORM)
  }

  async function spara(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setFel('')
    try {
      if (redigerar === 'nytt') await addObject(form)
      else await updateObject(redigerar, form)
      setRedigerar(null)
      await ladda()
    } catch (f) {
      setFel(felText(f))
    } finally {
      setBusy(false)
    }
  }

  async function vaxlaAktiv(o) {
    if (busy) return
    setBusy(true)
    setFel('')
    try {
      await setObjectAktiv(o.id, !o.aktiv)
      await ladda()
    } catch (f) {
      setFel(felText(f))
    } finally {
      setBusy(false)
    }
  }

  const satt = (falt) => (e) => setForm({ ...form, [falt]: e.target.value })

  const sattMottagare = (i, varde) => setForm({
    ...form,
    rapportmottagare: form.rapportmottagare.map((m, n) => (n === i ? varde : m))
  })
  const taBortMottagare = (i) => setForm({
    ...form,
    // Minst en rad kvar, annars försvinner fältet helt och det ser ut som
    // att objektet inte kan ha någon mottagare alls.
    rapportmottagare: form.rapportmottagare.length > 1
      ? form.rapportmottagare.filter((_, n) => n !== i)
      : ['']
  })

  if (laddfel) return <div className="panel"><Feltillstand fel={laddfel} onForsokIgen={ladda} /></div>

  const synliga = (objekt || []).filter((o) => visaInaktiva || o.aktiv)

  return (
    <>
      <Sidhuvud
        titel="Objekt"
        beskrivning="Hotellen ni rapporterar på. Standardtiderna förifylls när du lägger upp ett pass under Bemanning, och instruktionerna visas för värdarna högst upp i passloggen."
      >
        {redigerar === null && (
          <button className="btn primary" onClick={() => borja(null)}>Nytt objekt</button>
        )}
      </Sidhuvud>

      <div className="panel">

      {objekt === null ? (
        <div className="empty">Laddar…</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Namn</th><th>Kod</th><th>Standardpass</th>
                  <th>Rapporten går till</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {synliga.map((o) => (
                  <tr key={o.id} style={{ opacity: o.aktiv ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 700 }}>{o.namn}</td>
                    <td>{o.kod ? <code>{o.kod}</code> : <span style={{ color: 'var(--dim)' }}>—</span>}</td>
                    <td>
                      {o.standard_starttid
                        ? <span className="tid-txt">{o.standard_starttid}–{o.standard_sluttid || '?'}</span>
                        : <span style={{ color: 'var(--dim)' }}>—</span>}
                    </td>
                    <td>
                      {o.rapportmottagare?.length
                        ? <span className="mott-lista">{o.rapportmottagare.map((m) => <span className="mott" key={m}>{m}</span>)}</span>
                        : <span className="pill review">Ingen mottagare</span>}
                    </td>
                    <td>
                      <span className={'pill ' + (o.aktiv ? 'sent' : 'review')} style={{ marginLeft: 0 }}>
                        {o.aktiv ? 'Aktivt' : 'Inaktivt'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="linkbtn" disabled={busy} onClick={() => borja(o)}>Redigera</button>
                      {' · '}
                      <button className="linkbtn" disabled={busy} onClick={() => vaxlaAktiv(o)}>
                        {o.aktiv ? 'Inaktivera' : 'Aktivera'}
                      </button>
                    </td>
                  </tr>
                ))}
                {synliga.length === 0 && (
                  <tr><td colSpan={6}><div className="empty">Inga objekt ännu. Lägg till det första nedan.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="row-mellan">
            <label className="kryss">
              <input type="checkbox" checked={visaInaktiva} onChange={(e) => setVisaInaktiva(e.target.checked)} />
              Visa inaktiva
            </label>
          </div>

          {/* Objekt raderas aldrig — kaskaden skulle ta med passen, bemanningen
              och alla inlägg, inklusive rapporter som gått till kund. */}
          <div className="inc-hint">
            Objekt går att inaktivera, inte radera. Ett inaktivt objekt försvinner ur listorna men
            behåller sina pass och rapporter.
          </div>
        </>
      )}

      {redigerar !== null && (
        <form className="objekt-form" onSubmit={spara}>
          <div className="mini-lbl">{redigerar === 'nytt' ? 'Nytt objekt' : 'Redigera objekt'}</div>

          <div className="form-row">
            <div className="field" style={{ minWidth: 200 }}>
              <label htmlFor="obj-namn">Objektnamn</label>
              <input id="obj-namn" value={form.namn} onChange={satt('namn')} required />
            </div>
            <div className="field" style={{ maxWidth: 150 }}>
              <label htmlFor="obj-kod">Objektkod</label>
              <input id="obj-kod" value={form.kod} placeholder="DRAKEN" onChange={satt('kod')} />
            </div>
            <div className="field" style={{ maxWidth: 120 }}>
              <label htmlFor="obj-start">Passet börjar</label>
              <input id="obj-start" value={form.standard_starttid} placeholder="22:00" onChange={satt('standard_starttid')} />
            </div>
            <div className="field" style={{ maxWidth: 120 }}>
              <label htmlFor="obj-slut">Passet slutar</label>
              <input id="obj-slut" value={form.standard_sluttid} placeholder="06:00" onChange={satt('standard_sluttid')} />
            </div>
          </div>

          <div className="form-row">
            <div className="field" style={{ minWidth: 180 }}>
              <label htmlFor="obj-kontakt">Kontaktperson hos kund</label>
              <input id="obj-kontakt" value={form.kontaktperson} onChange={satt('kontaktperson')} />
            </div>
            <div className="field" style={{ maxWidth: 180 }}>
              <label htmlFor="obj-tel">Telefon</label>
              <input id="obj-tel" type="tel" value={form.kontakt_telefon} onChange={satt('kontakt_telefon')} />
            </div>
          </div>

          {/* fieldset/legend i stället för label: etiketten hör till hela
              gruppen adresser, inte till ett enskilt fält. */}
          <fieldset className="field mott-grupp">
            <legend>Rapporten skickas till</legend>
            {form.rapportmottagare.map((m, i) => (
              <div className="mott-rad" key={i}>
                <input type="email" value={m} placeholder="drift@hotellet.se"
                  inputMode="email" autoCapitalize="none" autoCorrect="off"
                  aria-label={`Mottagare ${i + 1}`}
                  onChange={(e) => sattMottagare(i, e.target.value)} />
                <button type="button" className="linkbtn" aria-label={`Ta bort mottagare ${i + 1}`}
                  onClick={() => taBortMottagare(i)}>Ta bort</button>
              </div>
            ))}
            <button type="button" className="btn" style={{ marginTop: 6 }}
              onClick={() => setForm({ ...form, rapportmottagare: [...form.rapportmottagare, ''] })}>
              + Lägg till mottagare
            </button>
          </fieldset>

          <div className="field">
            <label htmlFor="obj-instr">Instruktioner till värdarna</label>
            <textarea id="obj-instr" rows={3} value={form.instruktioner} onChange={satt('instruktioner')}
              placeholder="T.ex. var radion hämtas, när rooftop stänger, vilka dörrar som ska vara låsta." />
          </div>

          {fel && <div className="err" role="alert" style={{ height: 'auto', marginBottom: 10 }}>{fel}</div>}

          <div className="row-end">
            <button type="button" className="btn" disabled={busy} onClick={() => setRedigerar(null)}>Avbryt</button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Sparar…' : 'Spara'}
            </button>
          </div>
        </form>
      )}

      {fel && redigerar === null && (
        <div className="err" role="alert" style={{ height: 'auto', marginTop: 10 }}>{fel}</div>
      )}
      </div>
    </>
  )
}
