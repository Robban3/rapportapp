import { createContext, useContext, useEffect, useState } from 'react'

// Enkel session: vilken personal som är inloggad. Sparas i localStorage så
// man slipper logga in på nytt vid omladdning. (Byt till Supabase Auth när
// ni vill ha riktig autentisering — se README.)
const SessionCtx = createContext(null)
const KEY = 'rapportapp.session'

export function SessionProvider({ children }) {
  const [staff, setStaff] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null }
  })

  useEffect(() => {
    if (staff) localStorage.setItem(KEY, JSON.stringify(staff))
    else localStorage.removeItem(KEY)
  }, [staff])

  const isAdmin = staff?.roll === 'Admin'
  return (
    <SessionCtx.Provider value={{ staff, setStaff, logout: () => setStaff(null), isAdmin }}>
      {children}
    </SessionCtx.Provider>
  )
}

export const useSession = () => useContext(SessionCtx)
