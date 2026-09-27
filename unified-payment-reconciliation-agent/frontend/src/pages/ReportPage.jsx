/**
 * frontend/src/pages/ReportPage.jsx
 *
 * Hero view — calls GET /reconcile/runs/:runId/report (cache-first).
 * Displays the Gemini NL summary prominently, plus the run counts below it.
 */

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { api } from '../api/client'

function fmt(v) {
  if (v == null) return '—'
  return '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function StatPill({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 4, padding: '16px 20px',
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)', flex: 1, minWidth: 100,
    }}>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  )
}

export default function ReportPage() {
  const [searchParams] = useSearchParams()
  const urlRunId = searchParams.get('run_id')

  const [runId, setRunId]         = useState(urlRunId)
  const [run, setRun]             = useState(null)
  const [report, setReport]       = useState(null)
  const [loadingRun, setLoadingRun]   = useState(true)
  const [loadingReport, setLoadingReport] = useState(false)
  const [error, setError]         = useState(null)

  // Resolve run_id if not in URL
  useEffect(() => {
    async function resolve() {
      setLoadingRun(true)
      try {
        if (urlRunId) {
          const data = await api.getRun(urlRunId)
          setRun(data)
          setRunId(urlRunId)
        } else {
          const data = await api.getRuns()
          const completed = (data.runs || []).find((r) => r.status === 'completed')
          if (completed) {
            setRun(completed)
            setRunId(completed.run_id)
          }
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoadingRun(false)
      }
    }
    resolve()
  }, [urlRunId])

  // Fetch or generate the report once we have a runId
  const fetchReport = useCallback(async (id) => {
    if (!id) return
    setLoadingReport(true)
    setError(null)
    try {
      const data = await api.getRunReport(id)
      setReport(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingReport(false)
    }
  }, [])

  useEffect(() => {
    if (runId) fetchReport(runId)
  }, [runId, fetchReport])

  if (loadingRun) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '80px 0', color: 'var(--color-text-muted)' }}>
        <span className="spinner" />
        <span>Loading run data…</span>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="card fade-in" style={{ textAlign: 'center', padding: '60px 40px' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
        <h2 style={{ fontWeight: 700, marginBottom: 8 }}>No completed runs found</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 24 }}>
          Run a reconciliation first, then come back here for the AI report.
        </p>
        <Link to="/">
          <button className="btn btn-primary">← Go to Dashboard</button>
        </Link>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>

      {/* ── Header ───────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
          AI Reconciliation Report
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>
          Run Summary
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
          {run.run_id}
        </p>
      </div>

      {/* ── Stats row ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatPill label="Total"      value={run.total}      color="var(--color-text-primary)" />
        <StatPill label="Matched"    value={run.matched}    color="var(--color-matched)" />
        <StatPill label="Mismatched" value={run.mismatched} color="var(--color-mismatched)" />
        <StatPill label="Missing"    value={run.missing}    color="var(--color-missing)" />
        <StatPill label="Duplicate"  value={run.duplicate}  color="var(--color-duplicate)" />
        <StatPill label="Discrepancy" value={fmt(run.total_amount_discrepancy)} color="var(--color-mismatched)" />
      </div>

      {/* ── Hero: Gemini report ────────────────────────────────── */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(34,211,238,0.05))',
        border: '1px solid rgba(99,102,241,0.25)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Subtle glow orb */}
        <div style={{
          position: 'absolute', top: -60, right: -60,
          width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.15), transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 24 }}>🤖</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-primary)' }}>
              Gemini Analysis
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Generated by gemini-3.8-flash · {report?.cached ? 'Cached' : 'Freshly generated'}
            </div>
          </div>
        </div>

        {loadingReport && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 0', color: 'var(--color-text-secondary)' }}>
            <span className="spinner" />
            <span>Generating report with Gemini… this may take a few seconds</span>
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--color-missing)', padding: '10px 0' }}>
            ⚠️ {error}
          </div>
        )}

        {report?.summary && !loadingReport && (
          <p style={{
            fontSize: 17, lineHeight: 1.8,
            color: 'var(--color-text-primary)',
            fontWeight: 400, maxWidth: 700,
          }}>
            {report.summary}
          </p>
        )}

        {/* Regenerate button */}
        {!loadingReport && runId && (
          <button
            className="btn btn-secondary"
            id="btn-regenerate-report"
            onClick={() => fetchReport(runId)}
            style={{ marginTop: 20, fontSize: 12 }}
          >
            ↺ Regenerate Report
          </button>
        )}
      </div>

      {/* ── Link to results ────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12 }}>
        <Link to={`/results?run_id=${runId}`}>
          <button className="btn btn-secondary" id="btn-view-discrepancies">
            ⚠️ Review Discrepancies →
          </button>
        </Link>
        <Link to="/">
          <button className="btn btn-secondary">← Dashboard</button>
        </Link>
      </div>

    </div>
  )
}
