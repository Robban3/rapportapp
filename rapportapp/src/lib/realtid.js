// Realtid i passloggen.
//
// Pollningen ligger kvar som skyddsnät — en tappad WebSocket ska inte betyda
// att kollegans inlägg aldrig dyker upp — men när prenumerationen är uppe
// pollar appen glesare och inläggen syns direkt.
//
// I demoläget (ingen Supabase) finns inget att prenumerera på. Då returneras
// en tom avslutare och `pa` säger false, så pollningen fortsätter som förr.

import { hasSupabase, supabase } from './supabase.js'

/**
 * Prenumererar på ett pass: nya inlägg, ändrade inlägg och passets status.
 *
 * Callbacken får ingen data med sig, bara en signal om att något ändrats.
 * Klienten hämtar om från API:t i stället för att sätta ihop raden själv:
 * händelsen saknar signatur och rättelsemarkering, och en halvfärdig rad i
 * loggen är värre än en hämtning till.
 *
 * @param {string} passId
 * @param {{ onAndring: () => void, onStatus?: (pa: boolean) => void }} lyssnare
 * @returns {() => void} avsluta prenumerationen
 */
export function lyssnaPaPass(passId, { onAndring, onStatus }) {
  if (!hasSupabase || !passId) {
    onStatus?.(false)
    return () => {}
  }

  const kanal = supabase
    .channel(`passlogg:${passId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'inlagg', filter: `pass_id=eq.${passId}` },
      () => onAndring())
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'pass', filter: `id=eq.${passId}` },
      () => onAndring())
    .subscribe((status) => {
      // SUBSCRIBED = uppe. Allt annat (CHANNEL_ERROR, TIMED_OUT, CLOSED) ska
      // få pollningen att gå tätt igen.
      onStatus?.(status === 'SUBSCRIBED')
    })

  return () => {
    onStatus?.(false)
    supabase.removeChannel(kanal)
  }
}
