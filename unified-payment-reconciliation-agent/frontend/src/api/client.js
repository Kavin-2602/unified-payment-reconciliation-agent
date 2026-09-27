/**
 * frontend/src/api/client.js
 * Thin API client — all backend calls go through here.
 * BASE proxied via Vite to http://localhost:4000 in dev.
 */

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'

async function request(path, options = {}) {
  const url = `${BASE}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  // Health
  health: () => request('/health'),

  // Reconciliation — runs
  runReconciliation: (triggeredBy = 'manual') =>
    request(`/reconcile/run?triggered_by=${triggeredBy}`, { method: 'POST' }),
  getRuns: () => request('/reconcile/runs'),
  getRun: (runId) => request(`/reconcile/runs/${runId}`),

  // Reconciliation — results
  getResults: (params = {}) => {
    const q = new URLSearchParams()
    if (params.run_id) q.set('run_id', params.run_id)
    if (params.status)  q.set('status', params.status)
    if (params.limit)   q.set('limit', params.limit)
    if (params.explain) q.set('explain', 'true')
    return request(`/reconcile/results?${q}`)
  },
  getResult: (id, explain = false) =>
    request(`/reconcile/results/${id}${explain ? '?explain=true' : ''}`),

  // Report — GET /reconcile/runs/:runId/report (generates + caches)
  getRunReport: (runId) => request(`/reconcile/runs/${runId}/report`),
  getLatestReport: () => request('/reconcile/report'),

  // Upload
  uploadCsv: (file, source) => {
    const form = new FormData()
    form.append('file', file)
    form.append('source', source)
    return fetch(`${BASE}/upload/csv`, { method: 'POST', body: form }).then((r) => r.json())
  },
}
