// Rapporten som kunden får i mejlet.
//
// Ren funktion utan Deno-API:er, så den går att testa från apptesterna
// (rapportapp/src/lib/rapportmall.test.js) i stället för att bara antas
// fungera. Det som skickas till en kund ska inte vara det enda i kedjan
// som ingen kört.
//
// Layouten är avsiktligt gammaldags HTML — tabeller, inline-stilar, inga
// webbfonter. E-postklienter stryper allt annat: Outlook renderar med Word,
// och Gmail slänger <style>-block i vidarebefordrade mejl.

/** Speglar INCIDENT_TYPES i rapportapp/src/lib/incidents.js.
 *  Edge Functions bundlar bara sin egen mapp, så listan finns i två
 *  exemplar. Ett test jämför dem och faller om de glider isär. */
export const INCIDENT_TEXT: Record<string, string> = {
  hjalp_lamna: 'personer fick hjälp att lämna pga. berusning & störande av ordningen',
  ombads_lamna: 'personer ombads lämna pga. berusning & störande av ordningen',
  stannade_utanfor: 'personer fick stanna utanför entré pga. berusning',
  nekad_alder: 'personer nekades pga. ålder/klädkod',
  info_alkohol: 'personer informerades om utgång med alkohol'
}

export type Inlagg = {
  id: string
  tid: string
  meddelande: string
  signatur?: string | null
  incident_typ?: string | null
  ar_rattad?: boolean
  rattar_id?: string | null
}

export type RapportData = {
  objekt: { namn: string; kod?: string | null }
  pass: { datum: string; starttid?: string | null; sluttid?: string | null }
  roster: Array<{ initialer?: string | null; namn?: string | null; roll?: string | null; tid_in?: string | null; tid_ut?: string | null }>
  entries: Inlagg[]
  stats: Record<string, number>
}

/** Text som ska visas, inte tolkas. Ett inlägg är fritext skriven kl 02:00
 *  och kan innehålla vad som helst — utan den här hamnar det i kundens
 *  mejlklient som markup. */
export function esc(varde: unknown): string {
  return String(varde ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Texterna är skrivna i plural ("personer nekades ..."). Vid exakt en blir
 *  det "1 personer nekades", vilket ser slarvigt ut i något en kund betalar
 *  för. Alla fem texterna inleds med ordet, så en regel räcker. */
export function incidentText(nyckel: string, antal: number): string {
  const text = INCIDENT_TEXT[nyckel] ?? ''
  return antal === 1 ? text.replace(/^personer\b/, 'person') : text
}

export function amne(data: RapportData): string {
  return `Rapport ${data.objekt.namn} — ${data.pass.datum}`
}

/** Ren textversion. Mejl utan den hamnar oftare i skräpposten, och vissa
 *  läser fortfarande i klienter som inte visar HTML. */
export function textVersion(data: RapportData): string {
  const rader: string[] = []
  rader.push(`RAPPORT — ${data.objekt.namn}`)
  rader.push(`Pass ${data.pass.datum} ${data.pass.starttid || ''}–${data.pass.sluttid || ''}`.trim())
  rader.push('')

  rader.push('PERSONAL PÅ PASSET')
  if (data.roster.length === 0) rader.push('  (ingen registrerad)')
  for (const r of data.roster) {
    rader.push(`  ${r.initialer || ''} ${r.roll || ''} ${r.tid_in || ''}–${r.tid_ut || ''}`.replace(/\s+/g, ' ').trim())
  }
  rader.push('')

  rader.push('ANTECKNINGAR')
  for (const e of data.entries) {
    const marker = e.ar_rattad ? ' [RÄTTAD]' : e.rattar_id ? ' [RÄTTELSE]' : ''
    rader.push(`  ${e.tid}  ${e.meddelande} (${e.signatur || ''})${marker}`)
  }
  rader.push('')

  const taggade = Object.entries(INCIDENT_TEXT).filter(([k]) => (data.stats[k] || 0) > 0)
  if (taggade.length) {
    rader.push('SAMMANFATTNING')
    for (const [k] of taggade) rader.push(`  ${data.stats[k]} ${incidentText(k, data.stats[k])}`)
  }
  return rader.join('\n')
}

export function renderaHtml(data: RapportData): string {
  const { objekt, pass, roster, entries, stats } = data

  const personal = roster.length === 0
    ? '<tr><td style="padding:6px 0;color:#6a7f79">Ingen personal registrerad på passet.</td></tr>'
    : roster.map((r) => `
        <tr>
          <td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap">${esc(r.initialer)}</td>
          <td style="padding:5px 14px 5px 0">${esc(r.namn)}</td>
          <td style="padding:5px 14px 5px 0;color:#3c4f49">${esc(r.roll)}</td>
          <td style="padding:5px 0;color:#3c4f49;white-space:nowrap">${esc(r.tid_in)}–${esc(r.tid_ut)}</td>
        </tr>`).join('')

  // Ett rättat inlägg står kvar överstruket med rättelsen under. Kunden ska
  // se både vad som först skrevs och vad som gäller — samma regel som i
  // appen, och hela poängen med att inlägg inte går att redigera.
  const anteckningar = entries.length === 0
    ? '<tr><td style="padding:10px 0;color:#6a7f79">Inget skrevs i passet.</td></tr>'
    : entries.map((e) => {
      const struken = e.ar_rattad ? 'text-decoration:line-through;color:#6a7f79;' : ''
      const kant = e.rattar_id ? 'border-left:3px solid #0d9488;padding-left:11px;' : ''
      const marke = e.ar_rattad
        ? '<span style="font-size:10px;font-weight:700;color:#6a7f79;text-transform:uppercase">&nbsp;· Rättad</span>'
        : e.rattar_id
          ? '<span style="font-size:10px;font-weight:700;color:#0d9488;text-transform:uppercase">&nbsp;· Rättelse</span>'
          : ''
      return `
        <tr>
          <td style="padding:9px 14px 9px 0;vertical-align:top;font-family:monospace;font-weight:700;color:#0d9488;white-space:nowrap">${esc(e.tid)}</td>
          <td style="padding:9px 0;vertical-align:top;border-bottom:1px solid #dde7e3">
            <div style="${kant}">
              <div style="${struken}font-size:14px;line-height:1.5">${esc(e.meddelande)}</div>
              <div style="margin-top:3px;font-size:11px;color:#6a7f79;font-weight:700">${esc(e.signatur)}${marke}</div>
            </div>
          </td>
        </tr>`
    }).join('')

  // Bara det som faktiskt hänt. En lista med fem nollor säger ingenting och
  // gör rapporten längre att läsa på en telefon.
  const taggade = Object.entries(INCIDENT_TEXT).filter(([k]) => (stats[k] || 0) > 0)
  const sammanfattning = taggade.length === 0 ? '' : `
    <h2 style="margin:26px 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6a7f79">Sammanfattning</h2>
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      ${taggade.map(([k]) => `
        <tr>
          <td style="padding:4px 12px 4px 0;font-family:monospace;font-weight:700;color:#0d9488;vertical-align:top">${stats[k]}</td>
          <td style="padding:4px 0;font-size:13px">${esc(incidentText(k, stats[k]))}</td>
        </tr>`).join('')}
    </table>`

  return `<!doctype html>
<html lang="sv">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(amne(data))}</title></head>
<body style="margin:0;padding:0;background:#f5f8f7">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f8f7">
    <tr><td align="center" style="padding:24px 12px">
      <table cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;background:#ffffff;border:1px solid #dde7e3;border-radius:10px">
        <tr><td style="padding:26px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0e1c18">

          <h1 style="margin:0 0 4px;font-size:20px">${esc(objekt.namn)}</h1>
          <div style="font-size:13px;color:#3c4f49">
            Pass ${esc(pass.datum)} · ${esc(pass.starttid)}–${esc(pass.sluttid || '—')} ·
            ${roster.length} i personalen · ${entries.length} inlägg
          </div>

          <h2 style="margin:26px 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6a7f79">Personal på passet</h2>
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px">${personal}</table>

          <h2 style="margin:26px 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6a7f79">Anteckningar</h2>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">${anteckningar}</table>

          ${sammanfattning}

          <p style="margin:26px 0 0;font-size:11px;color:#6a7f79;line-height:1.6">
            Anteckningarna står i tidsordning räknat från passets start, så inlägg efter
            midnatt hamnar sist. Ett rättat inlägg står kvar överstruket med rättelsen
            under — inget tas bort ur en rapport.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
