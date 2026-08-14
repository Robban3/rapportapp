import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom'
import { useSession } from './state/session.jsx'
import { hasSupabase } from './lib/supabase.js'
import Login from './pages/Login.jsx'
import Objects from './pages/Objects.jsx'
import ShiftLog from './pages/ShiftLog.jsx'
import Admin from './pages/admin/Admin.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

function TopBar() {
  const { staff, logout, isAdmin } = useSession()
  const nav = useNavigate()
  if (!staff) return null
  return (
    <header className="topbar">
      <Link to="/" className="brand"><span className="brand-mark">R</span> Rapport</Link>
      <div className="topbar-right">
        {isAdmin && <Link to="/admin" className="link">Admin</Link>}
        <span className="chip"><span className="chip-av">{staff.initialer?.slice(0, 2)}</span>{staff.initialer}</span>
        <button className="link" onClick={() => { logout(); nav('/login') }}>Logga ut</button>
      </div>
    </header>
  )
}

function RequireAuth({ children, admin }) {
  const { staff, isAdmin } = useSession()
  if (!staff) return <Navigate to="/login" replace />
  if (admin && !isAdmin) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <>
      <TopBar />
      {!hasSupabase && (
        <div className="demo-banner">
          Demoläge — kör mot seed-data. Koder: <b>1111</b> ZÄEM · <b>4444</b> MOBO · <b>0000</b> Admin.
          Lägg in Supabase-creds i <code>.env.local</code> för skarp data.
        </div>
      )}
      <main className="app">
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RequireAuth><Objects /></RequireAuth>} />
            <Route path="/objekt/:objektId" element={<RequireAuth><ShiftLog /></RequireAuth>} />
            <Route path="/admin/*" element={<RequireAuth admin><Admin /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </>
  )
}
