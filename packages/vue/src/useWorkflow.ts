import { ref } from 'vue'
import { injectJixi } from './provide'
import type { WorkflowPayload, WorkflowResult } from '@jixi/js'

export function useWorkflow<T = unknown>(payload: WorkflowPayload) {
  const client = injectJixi()
  const data = ref<WorkflowResult<T> | null>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)

  async function run() {
    data.value = null
    loading.value = true
    error.value = null
    try {
      data.value = await client.run<T>(payload)
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, run }
}
