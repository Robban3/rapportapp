/**
 * Ikoner för sidopanelen. Inline-SVG i stället för ett ikonbibliotek — en
 * handfull ikoner motiverar inte ett beroende, och appen är en PWA där varje kilobyte
 * ska laddas ner över hotellets wifi.
 *
 * Alla ritas i currentColor, så de följer navigationens aktiva tillstånd.
 */
const bas = {
  width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
}

const former = {
  granska: <><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h8M8 17h4" /></>,
  skickat: <><path d="m4 12 16-8-6 16-2.5-6.2L4 12Z" /></>,
  objekt: <><path d="M3 21h18M5 21V6l7-3 7 3v15" /><path d="M9 21v-5h6v5M9 9h.01M15 9h.01M9 13h.01M15 13h.01" /></>,
  bemanning: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /><circle cx="9" cy="15" r="1.4" /><circle cx="14.5" cy="15" r="1.4" /></>,
  personal: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M17 11h4M19 9v4" /></>,
  passlogg: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M10 7h4M9.5 21h5" /></>,
  schema: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 9h18M8 13h3M8 17h3M14 13h2" /></>
}

export default function Ikon({ namn }) {
  const form = former[namn]
  return form ? <svg {...bas} className="ikon">{form}</svg> : null
}
