/**
 * frontend/src/pages/ResultsPage.jsx
 *
 * Discrepancy list — fetches GET /reconcile/results from the latest run.
 * Filters: All / MISMATCHED / MISSING / DUPLICATE (no MATCHED by default)
 * Clicking a row opens DetailModal which fetches ?explain=true.
 */

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api }           from '../api/client'
import { StatusBadge, STATUS_CONFIG } from '../components/StatusBadge'
import { DetailModal }   from '../components/DetailModal'

const FILTER_TABS = [
  { key: 'ALL',        label: 'All Discrepancies' },
  { key: 'MISMATCHED', label: '⚠️ Mismatched' },
  { key: 'MISSING',    label: '❌ Missing' },
  { key: 'DUPLICATE',  label: '♻️ Duplicate' },
  { key: 'MATCHED',    label: '✅ Matched' },
]

function fmt(amount) {
  if (amount == null) return '—'
  return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function DeltaCell({ delta, status }) {
  if (status === 'MISSING' || delta == null) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
  if (delta === 0) return <span style={{ color: 'var(--color-matched)', fontFamily: 'monospace' }}>±0</span>
  return (
    <span style={{ color: delta > 0 ? 'var(--color-matched)' : 'var(--color-mismatched)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
      {delta > 0 ? '+' : ''}{delta}
    </span>
  )
}

export default function ResultsPage() {
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('run_id')

  const [results, setResults]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [selectedId, setSelectedId] = useState(null)
  const [latestRunId, setLatestRunId] = useState(runId)

  // Resolve latest run_id if not in URL
  useEffect(() => {
    if (!runId) {
      api.getRuns().then((data) => {
        const completed = (data.runs || []).find((r) => r.status === 'completed')
        if (completed) setLatestRunId(completed.run_id)
      }).catch(() => {})
    }
  }, [runId])

  const fetchResults = useCallback(async () => {
    if (!latestRunId) return
    setLoading(true)
    setError(null)
    try {
      const params = { run_id: latestRunId, limit: 500 }
      // For ALL filter, exclude MATCHED to keep list focused on discrepancies by default
      // User can add MATCHED tab explicitly
      const data = await api.getResults(params)
      setResults(data.results || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [latestRunId])

  useEffect(() => { fetchResults() }, [fetchResults])

  const filtered = activeFilter === 'ALL'
    ? results.filter((r) => r.status !== 'MATCHED')
    : results.filter((r) => r.status === activeFilter)

  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})
  const discrepancyCount = (counts.MISMATCHED || 0) + (counts.MISSING || 0) + (counts.DUPLICATE || 0)

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>Transaction Results</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginTop: 4 }}>
          {latestRunId
            ? <><span className="mono" style={{ color: 'var(--color-text-muted)' }}>{latestRunId}</span> · {results.length} transactions · {discrepancyCount} need review</>
            : 'No run found — trigger a reconciliation from the Dashboard first'}
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTER_TABS.map(({ key, label }) => {
          const count = key === 'ALL' ? discrepancyCount : (counts[key] || 0)
          const active = activeFilter === key
          return (
            <button
              key={key}
              id={`btn-filter-${key.toLowerCase()}`}
              onClick={() => setActiveFilter(key)}
              style={{
                padding: '7px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: active ? 'var(--color-primary-glow)' : 'var(--color-bg-elevated)',
                color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {label}
              {count > 0 && (
                <span style={{
                  marginLeft: 6, fontSize: 11, fontWeight: 700,
                  background: active ? 'var(--color-primary)' : 'var(--color-bg-card)',
                  color: active ? '#fff' : 'var(--color-text-muted)',
                  padding: '1px 6px', borderRadius: 99,
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Results table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <span className="spinner" /> Loading results…
          </div>
        )}

        {error && (
          <div style={{ padding: '40px', color: 'var(--color-missing)', textAlign: 'center' }}>⚠️ {error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <p>No {activeFilter === 'ALL' ? 'discrepancies' : activeFilter.toLowerCase()} transactions found.</p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-elevated)' }}>
                  {['Transaction ID', 'Method', 'Source', 'Webhook ₹', 'Settlement ₹', 'Δ Delta', 'Status', ''].map((h) => (
                    <th key={h} style={{
                      padding: '11px 18px', textAlign: 'left',
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                      color: 'var(--color-text-muted)', whiteSpace: 'nowrap',
                      borderBottom: '1px solid var(--color-border)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr
                    key={row.id}
                    style={{
                      borderTop: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.008)',
                      transition: 'background 0.12s',
                    }}
                    onClick={() => setSelectedId(row.id)}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.008)'}
                  >
                    <td style={{ padding: '13px 18px' }}>
                      <span className="mono" style={{ color: 'var(--color-accent)', fontSize: 12 }}>
                        {row.transaction_id}
                      </span>
                    </td>
                    <td style={{ padding: '13px 18px', fontSize: 13, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                      {row.payment_method || '—'}
                    </td>
                    <td style={{ padding: '13px 18px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {row.settlement_source || '—'}
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{fmt(row.webhook_amount)}</span>
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <span className="mono">{fmt(row.settlement_amount)}</span>
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <DeltaCell delta={row.amount_delta} status={row.status} />
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <StatusBadge status={row.status} />
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      {row.status !== 'MATCHED' && (
                        <button
                          className="btn btn-secondary"
                          id={`btn-detail-${row.id}`}
                          style={{ padding: '4px 12px', fontSize: 11 }}
                          onClick={(e) => { e.stopPropagation(); setSelectedId(row.id) }}
                        >
                          Explain ›
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedId && (
        <DetailModal
          resultId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}
