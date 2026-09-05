import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Om env-variablerna saknas kör appen mot mock-datalagret (se api.js).
export const hasSupabase = Boolean(url && key)

// Hur länge ett anrop får hänga innan det räknas som förlorat.
//
// Utan tak fanns inget som bröt ett anrop som varken lyckas eller misslyckas —
// 3G i ett garage, en degraderad backend. Passloggen fastnade då på
// "Laddar passet…" som aldrig tog slut, och skicka-knappen låste sig
// permanent med texten kvar i fältet.
//
// Utkorgen räddade inte det heller: den triggar på ett KASTAT fel, och ett
// hängande anrop kastar aldrig. Med timeouten blir det ett fel som
// arNatverksfel känner igen, så inlägget hamnar i kön i stället för i
// tomma intet.
const TIMEOUT_MS = 15000

// Exporterad för att kunna testas: kopplingen mellan ett hängande anrop och
// ett fel som utkorgen känner igen är hela poängen med funktionen.
export function medTimeout(input, init = {}, timeoutMs = TIMEOUT_MS) {
  // Respektera en signal som anroparen redan skickat med.
  if (init.signal) return fetch(input, init)

  const styr = new AbortController()
  const klocka = setTimeout(() => styr.abort(new Error('timeout')), timeoutMs)

  return fetch(input, { ...init, signal: styr.signal })
    .catch((fel) => {
      // AbortError säger inget om varför. Texten nedan matchas av
      // arNatverksfel i utkorg.js, som avgör om inlägget ska köas.
      if (styr.signal.aborted) throw new TypeError('Network request failed: timeout')
      throw fel
    })
    .finally(() => clearTimeout(klocka))
}

export const supabase = hasSupabase
  ? createClient(url, key, { global: { fetch: medTimeout } })
  : null
