import { useState, useRef, useCallback, useEffect } from 'react'
import { JixiError } from '@jixi/js'
import type { RunWorkflowOptions } from '@jixi/js'
import { useJixiClient } from './context'
import type { JixiWorkflowResult } from './types'

export function useJixiWorkflow<TIn, TOut>(
  workflowName: string,
  options?: RunWorkflowOptions,
): JixiWorkflowResult<TIn, TOut> {
  const client = useJixiClient()
  const [data, setData] = useState<TOut | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<JixiError | null>(null)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const run = useCallback(
    async (input: TIn) => {
      abortControllerRef.current?.abort()
      const ac = new AbortController()
      abortControllerRef.current = ac

      setIsLoading(true)
      setError(null)

      try {
        const result = await client.runWorkflow<TIn, TOut>(workflowName, input, {
          ...optionsRef.current,
          signal: ac.signal,
        })
        if (ac.signal.aborted) return
        setData(result)
        setIsLoading(false)
      } catch (err) {
        if (err instanceof JixiError && err.code === 'aborted') return
        if (ac.signal.aborted) return
        setError(err instanceof JixiError ? err : new JixiError(String(err), 'unknown'))
        setIsLoading(false)
      }
    },
    [client, workflowName],
  )

  const reset = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setData(null)
    setIsLoading(false)
    setError(null)
  }, [])

  return { run, data, isLoading, error, reset }
}
