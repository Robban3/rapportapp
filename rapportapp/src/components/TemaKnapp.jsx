import { useEffect, useState } from 'react'
import { valtTema, galandeTema, sattTema, lyssnaPaSystemet } from '../lib/tema.js'

/**
 * Växlar ljust/mörkt. Tre lägen vore tydligare men kräver en meny — här
 * räcker en knapp som stegar mellan ljust och mörkt, eftersom systemvalet
 * redan gäller tills någon rör knappen.
 */
export default function TemaKnapp({ className = 'link' }) {
  const [tema, setTema] = useState(() => galandeTema(valtTema()))

  useEffect(() => lyssnaPaSystemet(), [])
  useEffect(() => {
    const vid = () => setTema(galandeTema(valtTema()))
    window.addEventListener('temabyte', vid)
    return () => window.removeEventListener('temabyte', vid)
  }, [])

  function vaxla() {
    const nytt = tema === 'morkt' ? 'ljust' : 'morkt'
    sattTema(nytt)
    setTema(nytt)
    window.dispatchEvent(new Event('temabyte'))
  }

  const morkt = tema === 'morkt'
  return (
    <button className={className} onClick={vaxla} aria-pressed={morkt}
      title={morkt ? 'Byt till ljust läge' : 'Byt till mörkt läge'}
      aria-label={morkt ? 'Byt till ljust läge' : 'Byt till mörkt läge'}>
      {morkt ? <Sol /> : <Mane />}
    </button>
  )
}

const svg = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

const Mane = () => <svg {...svg}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
const Sol = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
