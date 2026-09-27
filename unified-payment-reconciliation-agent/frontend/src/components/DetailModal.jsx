/**
 * frontend/src/components/DetailModal.jsx
 *
 * Slide-up modal showing full detail for a single reconciliation result.
 * Fetches GET /reconcile/results/:id?explain=true on open.
 * "Mark Reviewed" is local state only (no backend persistence needed).
 */

import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { StatusBadge } from './StatusBadge'

function fmt(amount) {
  if (amount == null) return '—'
  return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function DeltaChip({ delta }) {
  if (delta == null || delta === 0) return <span style={{ color: 'var(--color-matched)', fontFamily: 'monospace' }}>±0</span>
  const pos = delta > 0
  return (
    <span style={{
      fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15,
      color: pos ? 'var(--color-matched)' : 'var(--color-mismatched)',
    }}>
      {pos ? '+' : ''}{delta}
    </span>
  )
}

export function DetailModal({ resultId, onClose }) {
  const [detail, setDetail]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [reviewed, setReviewed] = useState(false)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const needs_explain = ['MISMATCHED', 'MISSING', 'DUPLICATE']
      const data = await api.getResult(resultId, needs_explain.includes('?')) // will be resolved below
      // Re-fetch with explain=true if this is a discrepancy
      if (needs_explain.includes(data.status)) {
        const withExplanation = await api.getResult(resultId, true)
        setDetail(withExplanation)
      } else {
        setDetail(data)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [resultId])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    /* Backdrop */
    <div
      id="modal-backdrop"
      onClick={(e) => e.target.id === 'modal-backdrop' && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '0 0 0 0',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      {/* Panel */}
      <div style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
        width: '100%', maxWidth: 720,
        maxHeight: '88vh', overflowY: 'auto',
        padding: 'var(--space-8)',
        animation: 'slideUp 0.3s cubic-bezier(0.16,1,0.3,1)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Transaction Detail
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--color-accent)' }}>
              {detail?.transaction_id ?? resultId}
            </h2>
          </div>
          <button
            onClick={onClose}
            id="btn-modal-close"
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-secondary)',
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >×</button>
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--color-text-secondary)', padding: '40px 0' }}>
            <span className="spinner" />
            <span>Fetching explanation from Gemini…</span>
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--color-missing)', padding: '20px 0' }}>
            ⚠️ {error}
          </div>
        )}

        {detail && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Status + source */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <StatusBadge status={detail.status} />
              {detail.payment_method && (
                <span style={{
                  fontSize: 12, padding: '3px 10px', borderRadius: 99,
                  background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)', textTransform: 'uppercase', fontWeight: 600,
                }}>
                  {detail.payment_method}
                </span>
              )}
              {detail.settlement_source && (
                <span style={{
                  fontSize: 12, padding: '3px 10px', borderRadius: 99,
                  background: 'var(--color-bg-elevated)', color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                }}>
                  via {detail.settlement_source}
                </span>
              )}
              {reviewed && (
                <span style={{
                  fontSize: 12, padding: '3px 10px', borderRadius: 99,
                  background: 'rgba(16,185,129,0.1)', color: 'var(--color-matched)',
                  border: '1px solid var(--color-matched)', fontWeight: 600,
                }}>
                  ✓ Reviewed
                </span>
              )}
            </div>

            {/* Amount comparison */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12,
            }}>
              {[
                { label: 'Webhook Amount', value: fmt(detail.webhook_amount), highlight: false },
                { label: 'Settlement Amount', value: fmt(detail.settlement_amount), highlight: false },
                { label: 'Discrepancy (Δ)', value: <DeltaChip delta={detail.amount_delta} />, highlight: true },
              ].map(({ label, value, highlight }) => (
                <div key={label} style={{
                  background: highlight ? 'rgba(245,158,11,0.06)' : 'var(--color-bg-elevated)',
                  border: `1px solid ${highlight ? 'rgba(245,158,11,0.2)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-md)', padding: '14px 16px',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* Discrepancy details */}
            {detail.discrepancy_details && (
              <div style={{
                background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)', padding: '14px 16px',
              }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Discrepancy Details
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  {detail.discrepancy_details.reason}
                </p>
              </div>
            )}

            {/* AI Explanation */}
            {detail.ai_explanation && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(34,211,238,0.04))',
                border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: 'var(--radius-md)', padding: '18px 20px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>🤖</span>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-primary)' }}>
                    Gemini Analysis
                  </span>
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-text-primary)' }}>
                  {detail.ai_explanation}
                </p>
              </div>
            )}

            {/* Recommended action */}
            {detail.recommended_action && (
              <div style={{
                background: 'rgba(16,185,129,0.06)',
                border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: 'var(--radius-md)', padding: '14px 16px',
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>→</span>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-matched)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                    Recommended Action
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
                    {detail.recommended_action}
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
              <button
                id={`btn-mark-reviewed-${detail.id}`}
                className="btn btn-secondary"
                onClick={() => setReviewed((v) => !v)}
                style={{ fontSize: 13 }}
              >
                {reviewed ? '↩ Unmark Reviewed' : '✓ Mark Reviewed'}
              </button>
              <button className="btn btn-secondary" onClick={onClose} style={{ fontSize: 13 }}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
