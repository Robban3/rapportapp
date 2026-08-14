// Incidenttyper. Ett inlägg kan valfritt taggas med en typ, och statistiken
// i rapporten räknas automatiskt från dessa taggar (i stället för att fyllas
// i manuellt vid pass-slut).

export const INCIDENT_TYPES = [
  { key: 'hjalp_lamna',      kort: 'Hjälpt lämna',   text: 'personer fick hjälp att lämna pga. berusning & störande av ordningen' },
  { key: 'ombads_lamna',     kort: 'Ombads lämna',   text: 'personer ombads lämna pga. berusning & störande av ordningen' },
  { key: 'stannade_utanfor', kort: 'Stannade ute',   text: 'personer fick stanna utanför entré pga. berusning' },
  { key: 'nekad_alder',      kort: 'Nekad ålder/kod',text: 'personer nekades pga. ålder/klädkod' },
  { key: 'info_alkohol',     kort: 'Info alkohol',   text: 'personer informerades om utgång med alkohol' }
]

export function emptyStats() {
  return Object.fromEntries(INCIDENT_TYPES.map((t) => [t.key, 0]))
}
