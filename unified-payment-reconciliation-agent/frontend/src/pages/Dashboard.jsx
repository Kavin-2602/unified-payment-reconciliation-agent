/**
 * frontend/src/pages/Dashboard.jsx
 *
 * Overview screen:
 * - "RECONCILE TODAY" button → POST /reconcile/run
 * - Animated checklist while in-flight
 * - Live stat cards from latest run
 * - Total discrepancy in ₹
 * - Link to Results and Report pages
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { StatCard }      from '../components/StatCard'
import { RunChecklist }  from '../components/RunChecklist'
import { useReconciliation } from '../hooks/useReconciliation'

function fmt(v) {
  if (v == null) return '—'
  return '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

export default function Dashboard() {
  const { latestRun, loadingRun, error, triggerRun, fetchLatestRun } = useReconciliation()
  const [running, setRunning]         = useState(false)
  const [runError, setRunError]       = useState(null)
  const [justCompleted, setJustCompleted] = useState(false)

  // Keep checklist visible for 3s after completion for the demo effect
  useEffect(() => {
    if (!running && justCompleted) {
      const t = setTimeout(() => setJustCompleted(false), 3000)
      return () => clearTimeout(t)
    }
  }, [running, justCompleted])

  async function handleRunReconciliation() {
    setRunning(true)
    setRunError(null)
    setJustCompleted(false)
    try {
      await triggerRun()
      setJustCompleted(true)
    } catch (e) {
      setRunError(e.message)
    } finally {
      setRunning(false)
    }
  }

  const run = latestRun

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>
            Reconciliation Dashboard
          </h1>
          {run ? (
            <p style={{ color: 'var(--color-text-secondary)', marginTop: 4, fontSize: 13 }}>
              Latest run: <span style={{ color: 'var(--color-text-primary)' }}>{formatDate(run.completed_at)}</span>
              {' · '}
              <span className="mono" style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{run.run_id}</span>
            </p>
          ) : (
            <p style={{ color: 'var(--color-text-muted)', marginTop: 4, fontSize: 13 }}>
              No runs yet — trigger one to begin
            </p>
          )}
        </div>

        <button
          className="btn btn-primary"
          onClick={handleRunReconciliation}
          disabled={running}
          id="btn-run-reconciliation"
          style={{ opacity: running ? 0.75 : 1, fontSize: 15, padding: '12px 24px' }}
        >
          {running ? <><span className="spinner" /> Running…</> : '⚡ Reconcile Today'}
        </button>
      </div>

      {/* ── Checklist animation ─────────────────────────────── */}
      {(running || justCompleted) && <RunChecklist active={running || justCompleted} />}

      {/* ── Error banner ────────────────────────────────────── */}
      {(runError || error) && (
        <div className="card fade-in" style={{ borderColor: 'var(--color-missing)', padding: 'var(--space-4)', display: 'flex', gap: 10 }}>
          <span>⚠️</span>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {runError || error}
            {(runError || '').includes('Backend') && (
              <> — make sure <code style={{ fontFamily: 'monospace' }}>npm run dev</code> is running in <code style={{ fontFamily: 'monospace' }}>backend/</code></>
            )}
          </span>
        </div>
      )}

      {/* ── Stat cards ──────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <StatCard
          label="Total Transactions" icon="📋"
          color="var(--color-text-primary)"
          value={run?.total ?? '—'}
        />
        <StatCard
          label="Matched" icon="✅"
          color="var(--color-matched)"
          value={run?.matched ?? '—'}
        />
        <StatCard
          label="Mismatched" icon="⚠️"
          color="var(--color-mismatched)"
          value={run?.mismatched ?? '—'}
        />
        <StatCard
          label="Missing" icon="❌"
          color="var(--color-missing)"
          value={run?.missing ?? '—'}
        />
        <StatCard
          label="Duplicate" icon="♻️"
          color="var(--color-duplicate)"
          value={run?.duplicate ?? '—'}
        />
        <StatCard
          label="Total Discrepancy" icon="₹"
          color="var(--color-mismatched)"
          value={run ? fmt(run.total_amount_discrepancy) : '—'}
        />
      </div>

      {/* ── Quick actions ────────────────────────────────────── */}
      {run && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* View discrepancies */}
          <Link to={`/results?run_id=${run.run_id}`} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-mismatched)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Review Discrepancies</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {(run.mismatched || 0) + (run.missing || 0) + (run.duplicate || 0)} transactions need attention
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--color-primary)', fontWeight: 600 }}>
                View all → 
              </div>
            </div>
          </Link>

          {/* View AI report */}
          <Link to={`/report?run_id=${run.run_id}`} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>🤖</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>AI Run Report</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Gemini-generated natural language summary
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--color-primary)', fontWeight: 600 }}>
                Read report →
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────── */}
      {!run && !running && (
        <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔁</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No reconciliation runs yet</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, maxWidth: 400, margin: '0 auto 24px' }}>
            Click "Reconcile Today" to run the deterministic matching engine over your
            uploaded settlement data and Dodo Payments webhook events.
          </p>
          <button
            className="btn btn-primary"
            onClick={handleRunReconciliation}
            id="btn-run-reconciliation-empty"
          >
            ⚡ Run First Reconciliation
          </button>
        </div>
      )}

    </div>
  )
}
