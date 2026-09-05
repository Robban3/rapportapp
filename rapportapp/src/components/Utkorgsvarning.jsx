import { useCallback, useEffect, useState } from 'react'
import { addEntry } from '../lib/api.js'
import { felmarkerade, forsokIgen, taBortFranKo, flusha } from '../lib/utkorg.js'

/**
 * Inlägg som skrivits utan nät och sedan nekats av servern.
 *
 * Kön töms för hela personen oavsett pass, men passloggen visar bara det pass
 * man står i. Ett inlägg från gårdagens numera låsta pass felmarkerades därför
 * och försvann ur allas synfält — texten låg kvar i telefonen, men ingen fick
 * veta att den aldrig nådde kundens rapport.
 *
 * Därför ligger den här varningen både i objektlistan och överst i passloggen:
 * den ska inte gå att missa, och den ska synas även när man står i ett annat
 * pass än det som nekade.
 */
export default function Utkorgsvarning({ personalId }) {
  const [poster, setPoster] = useState([])
  const [arbetar, setArbetar] = useState(null)   // id som just nu skickas om
  const [slanger, setSlanger] = useState(null)   // id som väntar på bekräftelse

  const las = useCallback(() => setPoster(felmarkerade(personalId)), [personalId])

  useEffect(() => {
    las()
    // Kön kan ha ändrats i en annan flik eller av pollningen i passloggen.
    window.addEventListener('focus', las)
    return () => window.removeEventListener('focus', las)
  }, [las])

  if (poster.length === 0) return null

  async function skickaOm(id) {
    if (arbetar) return
    setArbetar(id)
    try {
      forsokIgen(id)
      await flusha(personalId, addEntry)
    } catch { /* flusha markerar själv vad som inte gick fram */ }
    setArbetar(null)
    las()
  }

  function slang(id) {
    taBortFranKo(id)
    setSlanger(null)
    las()
  }

  return (
    <div className="utkorg-varning" role="alert">
      <div className="uv-rubrik">
        {poster.length === 1 ? 'Ett inlägg kom aldrig fram' : `${poster.length} inlägg kom aldrig fram`}
      </div>
      <div className="uv-hjalp">
        De skrevs utan nät och nekades när de skulle skickas. De finns bara i den
        här telefonen och saknas i rapporten.
      </div>

      {poster.map((k) => (
        <div className="uv-post" key={k.id}>
          <div className="uv-tid">{k.tid}</div>
          <div className="uv-text">
            <div>{k.meddelande}</div>
            <div className="uv-orsak">{k.fel}</div>
            {slanger === k.id ? (
              <div className="uv-knappar">
                <span className="uv-fraga">Släng texten? Den går inte att få tillbaka.</span>
                <button className="linkbtn" onClick={() => setSlanger(null)}>Behåll</button>
                <button className="linkbtn fara" onClick={() => slang(k.id)}>Släng</button>
              </div>
            ) : (
              <div className="uv-knappar">
                <button className="linkbtn" disabled={arbetar === k.id} onClick={() => skickaOm(k.id)}>
                  {arbetar === k.id ? 'Skickar…' : 'Försök igen'}
                </button>
                <button className="linkbtn fara" disabled={arbetar === k.id} onClick={() => setSlanger(k.id)}>
                  Ta bort
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
