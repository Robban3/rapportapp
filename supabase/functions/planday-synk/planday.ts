// Klienten mot Plandays Open API.
//
// Autentiseringen är OAuth2. Appen skapas i Planday under
// Settings → Integrations → API Access, och SCOPES VÄLJS DÄR — saknas ett
// scope svarar API:t 403 på just den resursen, inte vid inloggningen. Synken
// behöver:
//
//   shift:read          GET /scheduling/v1.0/shifts
//   shiftposition:read  GET /scheduling/v1.0/positions
//   läsrätt på anställda för /hr/.../employees
//
// Appen måste dessutom auktoriseras per Planday-portal; först då finns ett
// refresh-token under "Token" på samma sida. Det går inte ut. Access-token
// lever en timme och hämtas därför vid varje körning.
const TOKEN_URL = 'https://id.planday.com/connect/token'
const API = 'https://openapi.planday.com'

// Schemaresurserna dokumenteras som /scheduling/v1.0/..., men HR-exemplet i
// auktoriseringsguiden använder /hr/v1/Departments. Vilken som gäller för
// employees är inte utskrivet, så båda prövas i tur och ordning och den som
// svarar loggas. Att gissa fel här hade gett noll matchningar och lagt varenda
// anställd i planday_omatchad.
const HR_VAGAR = ['/hr/v1.0/employees', '/hr/v1/employees']

/** Plandays listsvar. `paging.total` är det som styr när vi är klara. */
type Sidsvar<T> = { data?: T[]; paging?: { offset: number; limit: number; total: number } }

export type Klient = { token: string; clientId: string }

export class PlandayFel extends Error {
  status: number
  detalj: string
  constructor(meddelande: string, status: number, detalj: string) {
    super(meddelande)
    this.name = 'PlandayFel'
    this.status = status
    this.detalj = detalj
  }
}

const sov = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Ett anrop med backoff.
 *
 * Planday svarar 429 vid för många anrop. En nattlig körning över 200 objekt
 * ligger nära gränsen, och utan backoff faller hela synken på en tillfällig
 * strypning i stället för att vänta två sekunder.
 */
async function medBackoff(url: string, init: RequestInit, forsok = 4): Promise<Response> {
  let vanta = 1000
  for (let n = 1; ; n++) {
    const svar = await fetch(url, init)
    if (svar.status !== 429 && svar.status < 500) return svar
    if (n >= forsok) return svar

    // Retry-After går före vår egen gissning när Planday säger hur länge.
    const sagt = Number(svar.headers.get('Retry-After'))
    const paus = Number.isFinite(sagt) && sagt > 0 ? sagt * 1000 : vanta
    console.warn('planday: väntar och försöker igen', { status: svar.status, paus, forsok: n })
    await svar.body?.cancel()
    await sov(paus)
    vanta = Math.min(vanta * 2, 16000)
  }
}

/** Byter refresh-token mot ett access-token. */
export async function loggaIn(clientId: string, refreshToken: string): Promise<Klient> {
  const svar = await medBackoff(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  })

  const kropp = await svar.text()
  if (!svar.ok) {
    throw new PlandayFel(
      `Planday nekade inloggningen (${svar.status}). Kontrollera PLANDAY_CLIENT_ID och PLANDAY_REFRESH_TOKEN.`,
      svar.status, kropp.slice(0, 300)
    )
  }

  const data = JSON.parse(kropp) as { access_token?: string }
  if (!data.access_token) {
    throw new PlandayFel('Planday svarade utan access_token.', svar.status, kropp.slice(0, 300))
  }
  return { token: data.access_token, clientId }
}

/**
 * Hämtar alla sidor av en lista.
 *
 * `limit` går till 5000 på skiftlistan, så hela horisonten för samtliga objekt
 * ryms i en handfull anrop. Loopen slutar när vi har `paging.total` poster
 * eller när en sida kommer tom — det senare för att aldrig snurra för evigt om
 * `total` skulle säga något annat än vad som faktiskt kommer.
 */
export async function hamtaAlla<T>(
  klient: Klient, vag: string, sokning: URLSearchParams, sidstorlek = 1000
): Promise<T[]> {
  const alla: T[] = []
  let offset = 0

  for (;;) {
    const q = new URLSearchParams(sokning)
    q.set('limit', String(sidstorlek))
    q.set('offset', String(offset))

    const svar = await medBackoff(`${API}${vag}?${q}`, {
      headers: {
        Authorization: `Bearer ${klient.token}`,
        'X-ClientId': klient.clientId
      }
    })

    const kropp = await svar.text()
    if (!svar.ok) {
      throw new PlandayFel(`Planday svarade ${svar.status} på ${vag}.`, svar.status, kropp.slice(0, 300))
    }

    const sida = JSON.parse(kropp) as Sidsvar<T>
    const poster = sida.data ?? []
    alla.push(...poster)

    const total = sida.paging?.total ?? alla.length
    if (poster.length === 0 || alla.length >= total) return alla
    offset += poster.length
  }
}

/**
 * E-postadressen ur en anställd.
 *
 * Fältnamnet är inte bekräftat ur dokumentationen — HR-sidan var blockerad när
 * klienten skrevs — så de rimliga kandidaterna prövas i tur och ordning och den
 * som träffar loggas en gång. Hellre det än att gissa ett namn och tyst få noll
 * matchningar: utan e-post hamnar varenda anställd i planday_omatchad.
 */
const EPOSTFALT = ['email', 'userName', 'primaryEmail', 'workEmail', 'emailAddress']
let rapporteratFalt = false

export function epostUr(anstalld: Record<string, unknown>): string | null {
  for (const falt of EPOSTFALT) {
    const varde = anstalld[falt]
    if (typeof varde === 'string' && varde.includes('@')) {
      if (!rapporteratFalt) {
        console.log('planday: hittade e-post i fältet', falt)
        rapporteratFalt = true
      }
      return varde
    }
  }
  return null
}

/**
 * Anställdregistret, oavsett vilken versionsväg portalen svarar på.
 *
 * En 404 betyder fel väg och ska provas om; allt annat — 403 för saknat scope,
 * 401 för utgången token — är ett riktigt fel som ska nå administratören.
 */
export async function hamtaAnstallda(klient: Klient): Promise<Record<string, unknown>[]> {
  let sist: PlandayFel | null = null

  for (const vag of HR_VAGAR) {
    try {
      const folk = await hamtaAlla<Record<string, unknown>>(klient, vag, new URLSearchParams(), 50)
      console.log('planday: läste anställda från', vag, `(${folk.length} st)`)
      return folk
    } catch (fel) {
      if (fel instanceof PlandayFel && fel.status === 404) { sist = fel; continue }
      throw fel
    }
  }

  throw sist ?? new PlandayFel('Hittade ingen väg till anställdregistret.', 404, HR_VAGAR.join(', '))
}

export function namnUr(anstalld: Record<string, unknown>): string | null {
  const delar = [anstalld.firstName, anstalld.lastName]
    .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
  if (delar.length > 0) return delar.join(' ')
  return typeof anstalld.name === 'string' ? anstalld.name : null
}
