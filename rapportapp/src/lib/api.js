// Enat datalager. Kör mot Supabase om creds finns, annars mot mock-datan.
// Alla funktioner returnerar samma form oavsett backend, så UI:t inte behöver
// bry sig om vilket som är aktivt.
//
// Regel: varje Supabase-anrop går genom kastaVidFel/kravRad. Ett svalt fel
// blir annars en tom lista eller en TypeError långt senare, och en värd mitt
// i ett pass får ingen aning om att inlägget inte sparades.

import { hasSupabase, supabase } from './supabase.js'
import { db } from './mockStore.js'
import { sortKey, nowHHMM, normalizeTid, verksamhetsdatum } from './time.js'
import { emptyStats, INCIDENT_TYPES } from './incidents.js'
import { ApiError, kastaVidFel, kravRad } from './errors.js'

const clone = (x) => JSON.parse(JSON.stringify(x))
const personalMed = (pid) => db.personal.find((p) => p.id === pid)

// ------------------------------------------------------------------ auth
export async function signIn(kod) {
  if (!hasSupabase) {
    return clone(db.personal.find((p) => p.kod === String(kod).trim() && p.aktiv) || null)
  }
  const svar = await supabase.from('personal').select('*').eq('kod', String(kod).trim()).eq('aktiv', true).maybeSingle()
  return kastaVidFel(svar, 'logga in') || null
}

// -------------------------------------------------------- objekt för person
export async function objectsForStaff(personalId) {
  if (!hasSupabase) {
    const ids = db.personalObjekt.filter(([pid]) => pid === personalId).map(([, oid]) => oid)
    return clone(db.objekt.filter((o) => ids.includes(o.id) && o.aktiv))
  }
  const svar = await supabase
    .from('personal_objekt')
    .select('objekt:objekt_id ( id, namn, kod, kund_epost, aktiv )')
    .eq('personal_id', personalId)
  const data = kastaVidFel(svar, 'hämta dina objekt')
  return (data || []).map((r) => r.objekt).filter((o) => o && o.aktiv)
}

/** Har personen behörighet till objektet? Kontrolleras innan pass öppnas. */
export async function harBehorighet(personalId, objektId) {
  const objekt = await objectsForStaff(personalId)
  return objekt.some((o) => o.id === objektId)
}

// -------------------------------------------------- öppet pass för ett objekt
export async function openPassForObjekt(objektId, datum = verksamhetsdatum()) {
  if (!hasSupabase) {
    let p = db.pass.find((x) => x.objekt_id === objektId && x.datum === datum)
    if (!p) {
      p = { id: db.newId(), objekt_id: objektId, datum, starttid: nowHHMM(), sluttid: null, status: 'oppet' }
      db.pass.push(p)
    }
    return clone(p)
  }

  const befintligt = kastaVidFel(
    await supabase.from('pass').select('*').eq('objekt_id', objektId).eq('datum', datum).maybeSingle(),
    'hämta passet'
  )
  if (befintligt) return befintligt

  // Två värdar som öppnar appen samtidigt vid passtart är normalfallet.
  // Krocken mot unique (objekt_id, datum) ska inte lämna den ena med ett
  // odefinierat pass och en permanent trasig sida — läs om i stället.
  const skapat = await supabase.from('pass')
    .insert({ objekt_id: objektId, datum, starttid: nowHHMM(), status: 'oppet' })
    .select().maybeSingle()

  if (skapat.error) {
    if (skapat.error.code === '23505') {
      return kravRad(
        await supabase.from('pass').select('*').eq('objekt_id', objektId).eq('datum', datum).maybeSingle(),
        'hämta passet någon annan just öppnade'
      )
    }
    throw new ApiError('Kunde inte öppna passet.', { orsak: skapat.error, kod: skapat.error.code })
  }
  return kravRad(skapat, 'öppna passet')
}

// ------------------------------------------------------ inlägg i ett pass
export async function entriesForPass(passId) {
  if (!hasSupabase) {
    return db.inlagg.filter((i) => i.pass_id === passId)
      .map((i) => ({ ...i, signatur: personalMed(i.personal_id)?.initialer }))
      .sort((a, b) => a.sortnyckel - b.sortnyckel || a.skapad_at.localeCompare(b.skapad_at))
  }
  const svar = await supabase
    .from('inlagg')
    .select('*, personal:personal_id ( initialer, namn )')
    .eq('pass_id', passId)
    .order('sortnyckel').order('skapad_at')
  const data = kastaVidFel(svar, 'hämta passloggen')
  return (data || []).map((i) => ({ ...i, signatur: i.personal?.initialer }))
}

export async function addEntry({ passId, personalId, tid, meddelande, incidentTyp = null, passStartTid = null }) {
  const text = String(meddelande || '').trim()
  if (!text) throw new ApiError('Inlägget saknar text.', { kod: 'tom_text' })

  const angivenTid = normalizeTid(tid) ?? normalizeTid(nowHHMM())
  if (!angivenTid) throw new ApiError('Tiden går inte att tolka. Skriv den som HH:MM.', { kod: 'ogiltig_tid' })

  const row = {
    pass_id: passId, personal_id: personalId, tid: angivenTid,
    sortnyckel: sortKey(angivenTid, passStartTid), meddelande: text,
    incident_typ: incidentTyp, last: true
  }

  if (!hasSupabase) {
    const saved = { ...row, id: db.newId(), skapad_at: new Date().toISOString() }
    db.inlagg.push(saved)
    return { ...saved, signatur: personalMed(personalId)?.initialer }
  }
  const data = kravRad(
    await supabase.from('inlagg').insert(row).select('*, personal:personal_id ( initialer )').maybeSingle(),
    'spara inlägget'
  )
  return { ...data, signatur: data.personal?.initialer }
}

// --------------------------------------------------------- admin: pass-lista
export async function passList(status) {
  // status: array av statusvärden, t.ex. ['oppet','granskas'] eller ['skickat']
  if (!hasSupabase) {
    return db.pass.filter((p) => status.includes(p.status))
      .map((p) => ({ ...p, objekt_namn: db.objekt.find((o) => o.id === p.objekt_id)?.namn }))
      .sort((a, b) => b.datum.localeCompare(a.datum))
  }
  const svar = await supabase.from('pass').select('*, objekt:objekt_id ( namn )').in('status', status).order('datum', { ascending: false })
  const data = kastaVidFel(svar, 'hämta passen')
  return (data || []).map((p) => ({ ...p, objekt_namn: p.objekt?.namn }))
}

// ------------------------------------------------- admin: sammanställd rapport
export async function report(passId) {
  const entries = await entriesForPass(passId)
  const stats = emptyStats()
  for (const e of entries) if (e.incident_typ && stats[e.incident_typ] != null) stats[e.incident_typ]++

  if (!hasSupabase) {
    const p = db.pass.find((x) => x.id === passId)
    if (!p) throw new ApiError('Passet finns inte.', { kod: 'saknas' })
    const objekt = db.objekt.find((o) => o.id === p.objekt_id)
    const roster = db.passPersonal.filter((r) => r.pass_id === passId).map((r) => ({
      ...r, initialer: personalMed(r.personal_id)?.initialer, namn: personalMed(r.personal_id)?.namn
    }))
    return { pass: clone(p), objekt: clone(objekt), roster, entries, stats }
  }

  const p = kravRad(
    await supabase.from('pass').select('*, objekt:objekt_id ( * )').eq('id', passId).maybeSingle(),
    'hämta rapporten'
  )
  const roster = kastaVidFel(
    await supabase.from('pass_personal').select('*, personal:personal_id ( initialer, namn )').eq('pass_id', passId),
    'hämta personalen på passet'
  )
  return {
    pass: p, objekt: p.objekt,
    roster: (roster || []).map((r) => ({ ...r, initialer: r.personal?.initialer, namn: r.personal?.namn })),
    entries, stats
  }
}

/**
 * Låser passet. OBS: genererar INGEN PDF och skickar INGET mejl — den
 * kedjan byggs i Fas 1.2 som en Edge Function. Returvärdet säger därför
 * `utskickat: false`, så UI:t inte kan påstå något annat för administratören.
 */
export async function lockAndSend(passId, epost) {
  if (!hasSupabase) {
    const p = db.pass.find((x) => x.id === passId)
    if (!p) throw new ApiError('Passet finns inte.', { kod: 'saknas' })
    p.status = 'skickat'
    p.skickad_at = new Date().toISOString()
    return { ok: true, epost, utskickat: false }
  }
  kastaVidFel(
    await supabase.from('pass').update({ status: 'skickat', skickad_at: new Date().toISOString() }).eq('id', passId),
    'låsa passet'
  )
  return { ok: true, epost, utskickat: false }
}

// ----------------------------------------------- admin: personal & behörighet
export async function listStaff() {
  if (!hasSupabase) return clone([...db.personal].sort((a, b) => a.initialer.localeCompare(b.initialer, 'sv')))
  const svar = await supabase.from('personal').select('*').order('initialer')
  return kastaVidFel(svar, 'hämta personalen') || []
}

export async function addStaff({ namn, initialer, roll, kod }) {
  const row = { namn: namn.trim(), initialer: initialer.trim(), roll, kod: kod.trim(), aktiv: true }
  if (!row.namn || !row.initialer || !row.kod) {
    throw new ApiError('Namn, initialer och kod måste fyllas i.', { kod: 'ofullstandig' })
  }

  if (!hasSupabase) {
    if (db.personal.some((p) => p.kod === row.kod)) {
      throw new ApiError('Koden används redan av någon annan.', { kod: 'dublett' })
    }
    const saved = { ...row, id: db.newId() }
    db.personal.push(saved)
    return clone(saved)
  }

  const svar = await supabase.from('personal').insert(row).select().maybeSingle()
  if (svar.error?.code === '23505') {
    throw new ApiError('Koden används redan av någon annan.', { orsak: svar.error, kod: 'dublett' })
  }
  return kravRad(svar, 'lägga till personalen')
}

export async function listObjects() {
  if (!hasSupabase) return clone([...db.objekt].sort((a, b) => a.namn.localeCompare(b.namn, 'sv')))
  const svar = await supabase.from('objekt').select('*').order('namn')
  return kastaVidFel(svar, 'hämta objekten') || []
}

export async function staffObjects(personalId) {
  if (!hasSupabase) return db.personalObjekt.filter(([pid]) => pid === personalId).map(([, oid]) => oid)
  const svar = await supabase.from('personal_objekt').select('objekt_id').eq('personal_id', personalId)
  return (kastaVidFel(svar, 'hämta behörigheterna') || []).map((r) => r.objekt_id)
}

export async function setStaffObjects(personalId, objektIds) {
  if (!hasSupabase) {
    db.personalObjekt = db.personalObjekt.filter(([pid]) => pid !== personalId)
      .concat(objektIds.map((oid) => [personalId, oid]))
    return { ok: true }
  }
  kastaVidFel(
    await supabase.from('personal_objekt').delete().eq('personal_id', personalId),
    'rensa gamla behörigheter'
  )
  if (objektIds.length) {
    kastaVidFel(
      await supabase.from('personal_objekt').insert(objektIds.map((oid) => ({ personal_id: personalId, objekt_id: oid }))),
      'spara behörigheterna'
    )
  }
  return { ok: true }
}

export { INCIDENT_TYPES }
