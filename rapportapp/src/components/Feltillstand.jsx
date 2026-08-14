import { felText } from '../lib/errors.js'

/**
 * Fel som gick att fånga: visa vad som hände och ge en väg vidare.
 * Utan "Försök igen" är enda utvägen att ladda om appen.
 */
export default function Feltillstand({ fel, onForsokIgen }) {
  return (
    <div className="empty" role="alert">
      <div style={{ marginBottom: onForsokIgen ? 12 : 0 }}>{felText(fel)}</div>
      {onForsokIgen && <button className="btn" onClick={onForsokIgen}>Försök igen</button>}
    </div>
  )
}
