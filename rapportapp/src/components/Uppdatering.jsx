import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * Säger till när en ny version finns.
 *
 * Service workern hämtar hem uppdateringen automatiskt, men bytet sker först
 * när alla flikar stängts. En värd som låter appen ligga kvar i app-växlaren
 * mellan passen kan därför köra flera veckor gammal kod utan att veta om det,
 * och enda felsökningsrådet blir "tvinga stäng appen" — vilket ingen kommer på
 * mitt i ett pass.
 *
 * Kontrollen görs också varje gång appen tas fram igen, inte bara vid
 * kallstart, eftersom kallstarten är just det som inte händer.
 */
export default function Uppdatering() {
  const [nyFinns, setNyFinns] = useState(false)
  const [uppdatera, setUppdatera] = useState(null)

  useEffect(() => {
    let uppdateraSW
    try {
      uppdateraSW = registerSW({
        immediate: true,
        onNeedRefresh() { setNyFinns(true) },
        onRegisteredSW(_url, registration) {
          if (!registration) return
          const kolla = () => { if (!document.hidden) registration.update().catch(() => {}) }
          document.addEventListener('visibilitychange', kolla)
          window.addEventListener('focus', kolla)
        }
      })
      setUppdatera(() => uppdateraSW)
    } catch {
      // Ingen service worker (äldre webbläsare, privat läge). Appen fungerar
      // ändå — den uppdateras bara som en vanlig sida.
    }
  }, [])

  if (!nyFinns) return null

  return (
    <div className="ny-version" role="status">
      <span>En ny version av Raptr finns.</span>
      <button className="linkbtn" onClick={() => uppdatera?.(true)}>Ladda om</button>
      <button className="linkbtn dim" onClick={() => setNyFinns(false)}>Senare</button>
    </div>
  )
}
