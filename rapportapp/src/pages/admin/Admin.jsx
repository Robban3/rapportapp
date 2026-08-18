import { Routes, Route, NavLink, Link, useNavigate } from 'react-router-dom'
import { useSession } from '../../state/session.jsx'
import { DemoBanner } from '../../App.jsx'
import ReviewList from './ReviewList.jsx'
import ReportDetail from './ReportDetail.jsx'
import Staff from './Staff.jsx'
import Bemanning from './Bemanning.jsx'
import Objekt from './Objekt.jsx'
import Ikon from '../../components/Ikon.jsx'
import TemaKnapp from '../../components/TemaKnapp.jsx'

const aktiv = ({ isActive }) => (isActive ? 'active' : '')

export default function Admin() {
  const { staff, logout } = useSession()
  const nav = useNavigate()

  return (
    <div className="admin-layout">
      {/* Sidopanelen bär varumärket, navigationen och den inloggade. Med den
          här behövs ingen topbar alls i adminläget — tidigare stod loggan och
          utloggningen i varsin ände av skärmen med tomrum emellan. */}
      <aside className="admin-side">
        <Link to="/" className="side-brand">
          <span className="brand-mark">R</span>
          <span>
            Rapport
            <small>Adminpanel</small>
          </span>
        </Link>

        <nav className="admin-nav">
          <div className="navlbl">Rapporter</div>
          <NavLink end to="/admin" className={aktiv}><Ikon namn="granska" />Att granska</NavLink>
          <NavLink to="/admin/skickade" className={aktiv}><Ikon namn="skickat" />Skickade</NavLink>

          <div className="navlbl">Administration</div>
          <NavLink to="/admin/objekt" className={aktiv}><Ikon namn="objekt" />Objekt</NavLink>
          <NavLink to="/admin/bemanning" className={aktiv}><Ikon namn="bemanning" />Bemanning</NavLink>
          <NavLink to="/admin/personal" className={aktiv}><Ikon namn="personal" />Personal &amp; behörighet</NavLink>

          <div className="navlbl">Värdappen</div>
          <NavLink to="/" className={aktiv}><Ikon namn="passlogg" />Öppna passlogg</NavLink>
        </nav>

        <div className="side-fot">
          <span className="chip">
            <span className="chip-av">{staff?.initialer?.slice(0, 2)}</span>{staff?.initialer}
          </span>
          <TemaKnapp />
          <button className="link" onClick={async () => { await logout(); nav('/login') }}>
            Logga ut
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <DemoBanner />
        <div className="admin-inner">
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
    </div>
  )
}
