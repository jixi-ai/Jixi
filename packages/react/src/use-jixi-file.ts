import { useCallback, useEffect, useRef, useState } from 'react'
import { JixiError } from '@jixi/js'
import type { JixiFile } from '@jixi/js'
import { useJixiClient } from './context'
import type { JixiFileResult } from './types'

export function useJixiFile(appId: string, fileId: string | null | undefined): JixiFileResult {
  const client = useJixiClient()
  const [file, setFile] = useState<JixiFile | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<JixiError | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    if (!fileId) {
      setFile(null)
      return null
    }
    setIsLoading(true)
    setError(null)
    try {
      const result = await client.getFile(appId, fileId)
      if (mountedRef.current) {
        setFile(result)
        setIsLoading(false)
      }
      return result
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof JixiError ? err : new JixiError(String(err), 'unknown'))
        setIsLoading(false)
      }
      return null
    }
  }, [client, appId, fileId])

  const reset = useCallback(() => {
    setFile(null)
    setIsLoading(false)
    setError(null)
  }, [])

  return { file, isLoading, error, reload, reset }
}
