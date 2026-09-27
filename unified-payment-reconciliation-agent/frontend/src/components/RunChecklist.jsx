/**
 * frontend/src/components/RunChecklist.jsx
 *
 * Animated checklist shown while POST /reconcile/run is in flight.
 * Steps are time-sequenced to feel alive during the demo (~2.5s total).
 * Does NOT reflect real backend progress — purely a visual affordance.
 */

import { useState, useEffect } from 'react'

const STEPS = [
  { id: 'load',    label: 'Loading transactions',       delay: 0 },
  { id: 'match',   label: 'Running deterministic matcher', delay: 600 },
  { id: 'disc',    label: 'Identifying discrepancies',  delay: 1300 },
  { id: 'ai',      label: 'Generating AI summary',      delay: 2000 },
  { id: 'done',    label: 'Report ready',               delay: 2600 },
]

export function RunChecklist({ active }) {
  const [completed, setCompleted] = useState([])

  useEffect(() => {
    if (!active) {
      setCompleted([])
      return
    }
    const timers = STEPS.map((step) =>
      setTimeout(() => setCompleted((prev) => [...prev, step.id]), step.delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [active])

  if (!active && completed.length === 0) return null

  return (
    <div className="card fade-in checklist-card">
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: 'var(--color-text-secondary)' }}>
        ⚡ Reconciliation in progress…
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {STEPS.map((step) => {
          const done = completed.includes(step.id)
          const isNext = !done && STEPS[completed.length]?.id === step.id
          return (
            <div key={step.id} className="checklist-step" style={{
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: done || isNext ? 1 : 0.3,
              transition: 'opacity 0.4s ease',
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12,
                background: done ? 'var(--color-matched-bg)' : isNext ? 'var(--color-primary-glow)' : 'var(--color-bg-elevated)',
                border: `1.5px solid ${done ? 'var(--color-matched)' : isNext ? 'var(--color-primary)' : 'var(--color-border)'}`,
                transition: 'all 0.3s ease',
              }}>
                {done ? '✓' : isNext ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : ''}
              </div>
              <span style={{
                fontSize: 13,
                color: done ? 'var(--color-matched)' : isNext ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                fontWeight: done ? 600 : 400,
                transition: 'color 0.3s ease',
              }}>
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
