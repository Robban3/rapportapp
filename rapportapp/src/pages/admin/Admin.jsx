import { Routes, Route, NavLink } from 'react-router-dom'
import ReviewList from './ReviewList.jsx'
import ReportDetail from './ReportDetail.jsx'
import Staff from './Staff.jsx'
import Bemanning from './Bemanning.jsx'
import Objekt from './Objekt.jsx'

export default function Admin() {
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <div className="navlbl">Rapporter</div>
        <NavLink end to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>Att granska</NavLink>
        <NavLink to="/admin/skickade" className={({ isActive }) => (isActive ? 'active' : '')}>Skickade</NavLink>
        <div className="navlbl">Administration</div>
        <NavLink to="/admin/objekt" className={({ isActive }) => (isActive ? 'active' : '')}>Objekt</NavLink>
        <NavLink to="/admin/bemanning" className={({ isActive }) => (isActive ? 'active' : '')}>Bemanning</NavLink>
        <NavLink to="/admin/personal" className={({ isActive }) => (isActive ? 'active' : '')}>Personal &amp; behörighet</NavLink>
      </nav>
      <div>
        <Routes>
          {/* key: utan den återanvänder React samma ReviewList-instans mellan
              rutterna, så den gamla listan visas under den nya rubriken. */}
          <Route index element={<ReviewList key="granska" status={['oppet', 'granskas']} title="Att granska" />} />
          <Route path="skickade" element={<ReviewList key="skickade" status={['skickat']} title="Skickade rapporter" />} />
          <Route path="pass/:passId" element={<ReportDetail />} />
          <Route path="objekt" element={<Objekt />} />
          <Route path="bemanning" element={<Bemanning />} />
          <Route path="personal" element={<Staff />} />
        </Routes>
      </div>
    </div>
  )
}
