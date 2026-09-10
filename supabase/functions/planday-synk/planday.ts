// Klienten mot Plandays Open API.
//
// Autentiseringen är OAuth2: en app registreras i Planday under
// Settings → API access, ger ett client_id, och auktoriseringsflödet ger ett
// refresh-token som inte går ut. Access-token lever en timme och hämtas därför
// vid varje körning.
//
// OBS: TOKEN_URL är den enda adressen som inte är bekräftad ur Plandays egen
// dokumentation — auktoriseringssidan var blockerad när klienten skrevs.
// Adressen följer IdentityServer-konventionen och matchar det bekräftade
// id.planday.com/connect/authorize. Stämmer den inte svarar Planday 404 eller
// 400 vid första körningen, och felet syns i planday_synk.fel. Det är en rad
// att rätta, och den skadar ingen data under tiden.
const TOKEN_URL = 'https://id.planday.com/connect/token'
const API = 'https://openapi.planday.com'

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

export function namnUr(anstalld: Record<string, unknown>): string | null {
  const delar = [anstalld.firstName, anstalld.lastName]
    .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
  if (delar.length > 0) return delar.join(' ')
  return typeof anstalld.name === 'string' ? anstalld.name : null
}
