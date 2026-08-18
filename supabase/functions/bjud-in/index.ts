// Bjuder in en person till Supabase Auth från adminpanelen.
//
// Att skapa konton kräver service_role-nyckeln, som går förbi all RLS och
// därför aldrig får finnas i webbläsaren. Funktionen kör serversidan: den
// kontrollerar först att anroparen verkligen är admin, och använder nyckeln
// först därefter.
//
// Nyckeln sätts som secret, aldrig i repot:
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
// (SUPABASE_URL och SUPABASE_ANON_KEY finns redan i funktionsmiljön.)

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const svar = (status: number, kropp: unknown) =>
  new Response(JSON.stringify(kropp), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  })

const EPOST_MONSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return svar(405, { fel: 'Endast POST.' })

  const url = Deno.env.get('SUPABASE_URL')
  const anonNyckel = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceNyckel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonNyckel || !serviceNyckel) {
    return svar(500, { fel: 'Funktionen saknar konfiguration. Sätt SUPABASE_SERVICE_ROLE_KEY som secret.' })
  }

  const auth = req.headers.get('Authorization')
  if (!auth) return svar(401, { fel: 'Du måste vara inloggad.' })

  // Den här klienten agerar som anroparen och lyder RLS. Den kan alltså inte
  // se eller göra något som personen inte redan får göra i appen.
  const somAnroparen = createClient(url, anonNyckel, {
    global: { headers: { Authorization: auth } }
  })

  const { data: { user }, error: userFel } = await somAnroparen.auth.getUser()
  if (userFel || !user) return svar(401, { fel: 'Din session har gått ut. Logga in igen.' })

  // Rollen läses från databasen mot anroparens EGET auth-id, som kommer från
  // den verifierade token. Den går inte att ljuga om från klienten.
  const { data: mig } = await somAnroparen
    .from('personal').select('roll, aktiv').eq('auth_user_id', user.id).maybeSingle()

  if (!mig?.aktiv || mig.roll !== 'Admin') {
    return svar(403, { fel: 'Bara administratörer får bjuda in personal.' })
  }

  let epost = ''
  try {
    epost = String(((await req.json()) as { epost?: string }).epost || '').trim().toLowerCase()
  } catch {
    return svar(400, { fel: 'Kunde inte läsa anropet.' })
  }
  if (!EPOST_MONSTER.test(epost)) return svar(400, { fel: 'E-postadressen ser inte giltig ut.' })

  // Adressen måste redan finnas som personal, annars skapas ett konto som
  // triggern inte kan koppla — och personen kan logga in utan att höra hemma
  // någonstans.
  const { data: mottagare } = await somAnroparen
    .from('personal').select('id, auth_user_id').eq('epost', epost).maybeSingle()

  if (!mottagare) {
    return svar(404, { fel: 'Ingen personal med den adressen. Lägg upp personen först.' })
  }
  if (mottagare.auth_user_id) {
    return svar(409, { fel: 'Personen har redan ett konto.' })
  }

  const admin = createClient(url, serviceNyckel)
  const { error } = await admin.auth.admin.inviteUserByEmail(epost, {
    redirectTo: req.headers.get('origin') ?? undefined
  })

  if (error) {
    // Vanligaste orsaken i skarp drift är att projektet saknar egen SMTP —
    // Supabases inbyggda utskick har hård kvot och är bara till för test.
    return svar(502, { fel: `Inbjudan gick inte att skicka: ${error.message}` })
  }
  return svar(200, { ok: true, epost })
})
