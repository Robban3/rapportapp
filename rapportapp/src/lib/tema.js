// Ljust eller mörkt läge.
//
// Passloggen används i mörk hotellobby kl 02:00 — en vit skärm är där ett
// arbetsmiljöproblem, inte en smaksak. Systemets inställning gäller som
// utgångspunkt, men värden måste kunna tvinga fram mörkt oavsett vad
// surfplattan är inställd på.

const NYCKEL = 'rapportapp.tema'
export const TEMAN = ['system', 'ljust', 'morkt']

/** Vad användaren valt: 'system', 'ljust' eller 'morkt'. */
export function valtTema() {
  try {
    const v = localStorage.getItem(NYCKEL)
    return TEMAN.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Vilket tema som faktiskt visas just nu — 'ljust' eller 'morkt'. */
export function galandeTema(val = valtTema()) {
  if (val !== 'system') return val
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'morkt' : 'ljust'
}

export function sattTema(val) {
  try { localStorage.setItem(NYCKEL, val) } catch { /* privat läge: kör vidare */ }
  applicera(val)
}

/**
 * Skriver temat på <html>. Attributet styr CSS-variablerna, och
 * theme-color-taggen så att webbläsarens egen ram följer med — annars lyser
 * en teal-remsa över en mörk app.
 */
export function applicera(val = valtTema()) {
  const galler = galandeTema(val)
  document.documentElement.dataset.tema = galler

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', galler === 'morkt' ? '#0a1512' : '#0d9488')
}

/** Följ systemet när användaren inte valt något själv. */
export function lyssnaPaSystemet() {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mq) return () => {}
  const vid = () => { if (valtTema() === 'system') applicera('system') }
  mq.addEventListener('change', vid)
  return () => mq.removeEventListener('change', vid)
}
