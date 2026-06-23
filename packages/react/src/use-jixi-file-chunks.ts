import { useCallback, useEffect, useRef, useState } from 'react'
import { JixiError } from '@jixi/js'
import type { FileChunkQuery, JixiFileChunk } from '@jixi/js'
import { useJixiClient } from './context'
import type { JixiFileChunksResult } from './types'

export function useJixiFileChunks(
  appId: string,
  fileId: string | null | undefined,
  options?: FileChunkQuery,
): JixiFileChunksResult {
  const client = useJixiClient()
  const [chunks, setChunks] = useState<JixiFileChunk[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<JixiError | null>(null)
  const mountedRef = useRef(true)
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    if (!fileId) {
      setChunks([])
      return null
    }
    setIsLoading(true)
    setError(null)
    try {
      const result = await client.listFileChunks(appId, fileId, optionsRef.current)
      if (mountedRef.current) {
        setChunks(result)
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
    setChunks([])
    setIsLoading(false)
    setError(null)
  }, [])

  return { chunks, isLoading, error, reload, reset }
}
