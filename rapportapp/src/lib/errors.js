// Fel som datalagret kastar. Poängen är att UI:t ska kunna visa något
// begripligt för en värd kl 02:00 i stället för en vit skärm eller en
// "Laddar…" som aldrig tar slut.

export class ApiError extends Error {
  constructor(meddelande, { orsak = null, kod = null } = {}) {
    super(meddelande)
    this.name = 'ApiError'
    this.orsak = orsak
    this.kod = kod
  }
}

/**
 * Kastar om Supabase svarade med ett fel. Tidigare plockades bara `data` ut
 * och `error` ignorerades, så ett nekat RLS-anrop eller ett nätverksfel såg
 * ut som "inga rader" — och kraschade först längre ner med TypeError.
 */
export function kastaVidFel(svar, vadSomGjordes) {
  if (svar?.error) {
    throw new ApiError(`Kunde inte ${vadSomGjordes}.`, {
      orsak: svar.error,
      kod: svar.error.code
    })
  }
  return svar?.data
}

/** Samma sak, men kräver dessutom att en rad faktiskt kom tillbaka. */
export function kravRad(svar, vadSomGjordes) {
  const data = kastaVidFel(svar, vadSomGjordes)
  if (data === null || data === undefined) {
    throw new ApiError(`Hittade inget när appen skulle ${vadSomGjordes}.`, { kod: 'saknas' })
  }
  return data
}

/** Text som går att visa för användaren. */
export function felText(fel) {
  if (fel instanceof ApiError) return fel.message
  if (fel?.message === 'Failed to fetch') return 'Ingen kontakt med servern. Kontrollera nätet.'
  return 'Något gick fel. Försök igen.'
}
