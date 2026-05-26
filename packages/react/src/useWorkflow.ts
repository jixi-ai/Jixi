import { useState, useCallback } from 'react'
import { useJixiContext } from './provider'
import type { WorkflowPayload, WorkflowResult } from '@jixi/js'

interface WorkflowState<T> {
  data: WorkflowResult<T> | null
  loading: boolean
  error: Error | null
}

export function useWorkflow<T = unknown>(payload: WorkflowPayload) {
  const client = useJixiContext()
  const [state, setState] = useState<WorkflowState<T>>({ data: null, loading: false, error: null })

  const run = useCallback(async () => {
    setState({ data: null, loading: true, error: null })
    try {
      const result = await client.run<T>(payload)
      setState({ data: result, loading: false, error: null })
    } catch (err) {
      setState({ data: null, loading: false, error: err instanceof Error ? err : new Error(String(err)) })
    }
  }, [client, payload])

  return { ...state, run }
}
