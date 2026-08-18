/**
 * Sidhuvud för adminvyerna: titel och beskrivning UTANFÖR kortet, med plats
 * för sidans primäråtgärd till höger.
 *
 * Poängen är hierarkin. Låg titeln inne i kortet blev sidan och kortet samma
 * sak, och primärknappen hamnade längst ner där man först ser den efter att
 * ha scrollat förbi allt annat.
 */
export default function Sidhuvud({ titel, beskrivning, children }) {
  return (
    <header className="sidhuvud">
      <div>
        <h1>{titel}</h1>
        {beskrivning && <p>{beskrivning}</p>}
      </div>
      {children && <div className="sidhuvud-atgard">{children}</div>}
    </header>
  )
}
