import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { hasSupabase } from '../lib/supabase.js'
import { aktuellPersonal, signOut as apiSignOut, onAuthChange } from '../lib/api.js'

// Vem som är inloggad.
//
// Mot Supabase äger auth-klienten sessionen och förnyar token själv; vi speglar
// bara personalraden hit. I demoläget finns ingen autentisering alls, och då
// ligger valet kvar i localStorage precis som förut.
const SessionCtx = createContext(null)
const KEY = 'rapportapp.session'

export function SessionProvider({ children }) {
  const [staff, setStaff] = useState(() => {
    if (hasSupabase) return null
    try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null }
  })

  // Mot Supabase vet vi inte om någon är inloggad förrän sessionen lästs från
  // lagringen. Utan det här tillståndet skulle en omladdning slänga ut en
  // inloggad värd till inloggningssidan innan svaret hunnit fram.
  const [laddar, setLaddar] = useState(hasSupabase)

  useEffect(() => {
    if (hasSupabase) return
    if (staff) localStorage.setItem(KEY, JSON.stringify(staff))
    else localStorage.removeItem(KEY)
  }, [staff])

  useEffect(() => {
    if (!hasSupabase) return
    let levande = true

    const las = () => aktuellPersonal()
      .then((p) => { if (levande) { setStaff(p); setLaddar(false) } })
      .catch(() => { if (levande) { setStaff(null); setLaddar(false) } })

    las()
    const sluta = onAuthChange(las)
    return () => { levande = false; sluta() }
  }, [])

  const logout = useCallback(async () => {
    await apiSignOut()
    setStaff(null)
  }, [])

  const isAdmin = staff?.roll === 'Admin'
  return (
    <SessionCtx.Provider value={{ staff, setStaff, logout, isAdmin, laddar }}>
      {children}
    </SessionCtx.Provider>
  )
}

export const useSession = () => useContext(SessionCtx)
