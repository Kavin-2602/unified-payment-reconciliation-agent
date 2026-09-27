/**
 * frontend/src/hooks/useReconciliation.js
 * Shared state for the latest reconciliation run and results.
 * Fetches from backend on mount; re-fetches after each run trigger.
 */

import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

export function useReconciliation() {
  const [latestRun, setLatestRun]       = useState(null)
  const [results, setResults]           = useState([])
  const [loadingRun, setLoadingRun]     = useState(false)
  const [loadingResults, setLoadingResults] = useState(false)
  const [error, setError]               = useState(null)

  // Fetch the most recent completed run
  const fetchLatestRun = useCallback(async () => {
    try {
      const data = await api.getRuns()
      const runs = data.runs || []
      const completed = runs.find((r) => r.status === 'completed')
      if (completed) setLatestRun(completed)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // Fetch all results for a run (discrepancies only by default)
  const fetchResults = useCallback(async (runId, statusFilter = null) => {
    setLoadingResults(true)
    try {
      const params = { run_id: runId, limit: 200 }
      if (statusFilter) params.status = statusFilter
      const data = await api.getResults(params)
      setResults(data.results || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingResults(false)
    }
  }, [])

  // Trigger a new reconciliation run
  const triggerRun = useCallback(async () => {
    setLoadingRun(true)
    setError(null)
    try {
      const result = await api.runReconciliation()
      // Refresh the latest run immediately
      await fetchLatestRun()
      return result
    } catch (e) {
      setError(e.message)
      throw e
    } finally {
      setLoadingRun(false)
    }
  }, [fetchLatestRun])

  useEffect(() => {
    fetchLatestRun()
  }, [fetchLatestRun])

  return {
    latestRun,
    results,
    loadingRun,
    loadingResults,
    error,
    triggerRun,
    fetchResults,
    fetchLatestRun,
  }
}
