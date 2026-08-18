import { createContext, useContext } from 'react'

// Kontexten och kroken bor här, inte i session.jsx. En modul som exporterar
// både en komponent och något annat tappar Fast Refresh: hela modulen laddas
// om vid varje ändring och den inloggade nollställs mitt i arbetet.
export const SessionCtx = createContext(null)

export const useSession = () => useContext(SessionCtx)
