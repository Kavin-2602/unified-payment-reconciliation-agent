/**
 * frontend/src/components/StatCard.jsx
 * A single stat count card for the dashboard overview row.
 */

export function StatCard({ label, value, color, icon, sub }) {
  return (
    <div className="card stat-card" style={{ flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
      <div style={{
        fontSize: 36, fontWeight: 800, color,
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
      }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 6 }}>{label}</div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
          {sub}
        </div>
      )}
    </div>
  )
}
