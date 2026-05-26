import { writable, derived } from 'svelte/store'
import type { WorkflowResult } from '@jixi/js'

interface WorkflowState<T> {
  data: WorkflowResult<T> | null
  loading: boolean
  error: Error | null
}

export function workflowStore<T = unknown>() {
  const state = writable<WorkflowState<T>>({ data: null, loading: false, error: null })
  const loading = derived(state, ($s) => $s.loading)
  const error = derived(state, ($s) => $s.error)
  const data = derived(state, ($s) => $s.data)
  return { state, loading, error, data }
}
