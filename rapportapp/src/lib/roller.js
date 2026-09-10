/**
 * Rollerna en person kan ha på ett pass.
 *
 * Låg tidigare i tre exemplar — Staff.jsx, Bemanning.jsx och Veckoschema.jsx —
 * varav ett hade med Admin och två inte. En roll som läggs till på ett ställe
 * men inte de andra ger en rullgardin som saknar valet.
 *
 * Listan finns i ett fjärde exemplar som inte går att undvika: `ROLLER` i
 * supabase/functions/planday-synk/normalisera.ts, eftersom Edge Functions bara
 * bundlar sin egen mapp. Den jämförs mot den här i planday.test.js.
 */
export const ROLLER = ['Värd', 'Ordningsvakt', 'Garderob']

/**
 * Rollerna i personalregistret. Admin är en behörighet i Raptr, inte en
 * position på ett pass — därför står den bara här, och en Planday-position kan
 * aldrig göra någon till administratör.
 */
export const PERSONALROLLER = [...ROLLER, 'Admin']
