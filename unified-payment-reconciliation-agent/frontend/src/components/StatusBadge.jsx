/**
 * frontend/src/components/StatusBadge.jsx
 */

export const STATUS_CONFIG = {
  MATCHED:    { color: 'var(--color-matched)',    bg: 'var(--color-matched-bg)',    icon: '✅', label: 'Matched' },
  MISMATCHED: { color: 'var(--color-mismatched)', bg: 'var(--color-mismatched-bg)', icon: '⚠️', label: 'Mismatched' },
  MISSING:    { color: 'var(--color-missing)',    bg: 'var(--color-missing-bg)',    icon: '❌', label: 'Missing' },
  DUPLICATE:  { color: 'var(--color-duplicate)',  bg: 'var(--color-duplicate-bg)',  icon: '♻️', label: 'Duplicate' },
}

export function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '?', label: status }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: cfg.color, background: cfg.bg,
    }}>
      {cfg.icon} {cfg.label}
    </span>
  )
}
