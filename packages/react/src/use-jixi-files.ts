import { useCallback, useEffect, useRef, useState } from 'react'
import { JixiError } from '@jixi/js'
import type {
  CreateFileInput,
  JixiFile,
  UpdateFileInput,
  UploadFileOptions,
  WriteFileInput,
} from '@jixi/js'
import { useJixiClient } from './context'
import type { JixiFilesResult } from './types'

export function useJixiFiles(appId: string): JixiFilesResult {
  const client = useJixiClient()
  const [files, setFiles] = useState<JixiFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<JixiError | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await fn()
      if (mountedRef.current) setIsLoading(false)
      return result
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof JixiError ? err : new JixiError(String(err), 'unknown'))
        setIsLoading(false)
      }
      return null
    }
  }, [])

  const reload = useCallback(async () => {
    const result = await run(() => client.listFiles(appId))
    if (result && mountedRef.current) setFiles(result)
    return result
  }, [client, appId, run])

  const create = useCallback(async (input: CreateFileInput) => {
    const result = await run(() => client.createFile(appId, input))
    if (result) await reload()
    return result
  }, [client, appId, run, reload])

  const write = useCallback(async (input: WriteFileInput) => {
    const result = await run(() => client.writeFile(appId, input))
    if (result) await reload()
    return result
  }, [client, appId, run, reload])

  const upload = useCallback(async (fileId: string, file: Blob, options?: UploadFileOptions) => {
    const result = await run(() => client.uploadFile(appId, fileId, file, options))
    if (result) await reload()
    return result
  }, [client, appId, run, reload])

  const update = useCallback(async (fileId: string, input: UpdateFileInput) => {
    const result = await run(() => client.updateFile(appId, fileId, input))
    if (result) await reload()
    return result
  }, [client, appId, run, reload])

  const remove = useCallback(async (fileId: string) => {
    const result = await run(() => client.deleteFile(appId, fileId))
    await reload()
    return result
  }, [client, appId, run, reload])

  const reset = useCallback(() => {
    setFiles([])
    setIsLoading(false)
    setError(null)
  }, [])

  return {
    files,
    isLoading,
    error,
    reload,
    create,
    write,
    upload,
    update,
    remove,
    reset,
  }
}
