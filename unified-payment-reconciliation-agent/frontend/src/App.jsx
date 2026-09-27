import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard   from './pages/Dashboard'
import ResultsPage from './pages/ResultsPage'
import ReportPage  from './pages/ReportPage'
import './index.css'

const NAV_LINKS = [
  { to: '/',        label: 'Dashboard',  exact: true },
  { to: '/results', label: 'Results' },
  { to: '/report',  label: 'AI Report' },
]

function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* ── Top nav ──────────────────────────────────────── */}
        <header style={{
          background: 'var(--color-bg-surface)',
          borderBottom: '1px solid var(--color-border)',
          position: 'sticky', top: 0, zIndex: 50,
        }}>
          <div className="container flex items-center justify-between" style={{ height: 60 }}>
            {/* Logo */}
            <div className="flex items-center gap-2">
              <span style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, flexShrink: 0,
              }}>⚡</span>
              <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>
                Unified <span style={{ color: 'var(--color-primary)' }}>Stream</span>
              </span>
              <span style={{
                fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                color: 'var(--color-text-muted)', marginLeft: 4, textTransform: 'uppercase',
              }}>
                MSME Recon Agent
              </span>
            </div>

            {/* Nav */}
            <nav className="flex gap-2">
              {NAV_LINKS.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  style={({ isActive }) => ({
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 14, fontWeight: 500,
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    background: isActive ? 'var(--color-primary-glow)' : 'transparent',
                    transition: 'all var(--transition-fast)',
                  })}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        {/* ── Pages ────────────────────────────────────────── */}
        <main style={{ flex: 1, padding: '32px 0' }}>
          <div className="container">
            <Routes>
              <Route path="/"        element={<Dashboard />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/report"  element={<ReportPage />} />
            </Routes>
          </div>
        </main>

        {/* ── Footer ───────────────────────────────────────── */}
        <footer style={{
          borderTop: '1px solid var(--color-border)',
          padding: '16px 0', textAlign: 'center',
          fontSize: 12, color: 'var(--color-text-muted)',
        }}>
          Unified Stream · EmberGround AI Hackathon 2026 · Built with Dodo Payments + Gemini
        </footer>
      </div>
    </BrowserRouter>
  )
}

export default App
