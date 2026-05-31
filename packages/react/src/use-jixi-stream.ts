import { useState, useRef, useCallback, useEffect } from 'react'
import { JixiError } from '@jixi/js'
import type { JixiStream, WorkflowRunEvent, ContentChunkData, RunWorkflowOptions } from '@jixi/js'
import type { WorkflowMessageData, WorkflowFailedData } from '@jixi/js'
import { useJixiClient } from './context'
import type { JixiStreamResult } from './types'

export function useJixiStream<TIn>(
  workflowName: string,
  options?: RunWorkflowOptions,
): JixiStreamResult<TIn> {
  const client = useJixiClient()

  const [events, setEvents] = useState<WorkflowRunEvent[]>([])
  const [latestMessage, setLatestMessage] = useState<string | null>(null)
  const [contentChunks, setContentChunks] = useState<ContentChunkData[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<JixiError | null>(null)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const streamRef = useRef<JixiStream | null>(null)

  useEffect(() => {
    return () => {
      streamRef.current?.cancel()
    }
  }, [])

  const cancel = useCallback(() => {
    streamRef.current?.cancel()
    setIsStreaming(false)
  }, [])

  const reset = useCallback(() => {
    streamRef.current?.cancel()
    streamRef.current = null
    setEvents([])
    setLatestMessage(null)
    setContentChunks([])
    setIsStreaming(false)
    setIsComplete(false)
    setError(null)
  }, [])

  const run = useCallback(
    async (input: TIn) => {
      streamRef.current?.cancel()

      setEvents([])
      setLatestMessage(null)
      setContentChunks([])
      setError(null)
      setIsStreaming(true)
      setIsComplete(false)

      try {
        const stream = await client.runWorkflowStream<TIn>(workflowName, input, optionsRef.current)
        streamRef.current = stream

        for await (const event of stream) {
          setEvents((prev) => [...prev, event])

          if (event.type === 'workflow_message') {
            setLatestMessage((event.data as unknown as WorkflowMessageData).message)
          }

          if (event.type === 'content_chunk') {
            setContentChunks((prev) => [...prev, event.data as unknown as ContentChunkData])
          }

          if (event.type === 'workflow_completed') {
            setIsStreaming(false)
            setIsComplete(true)
          }

          if (event.type === 'workflow_failed') {
            const failData = event.data as unknown as WorkflowFailedData
            setIsStreaming(false)
            setError(
              new JixiError(failData.error, 'server_error', {
                workflowName,
                durationMs: failData.durationMs,
              }),
            )
          }
        }
      } catch (err) {
        if (err instanceof JixiError && err.code === 'aborted') return
        setError(err instanceof JixiError ? err : new JixiError(String(err), 'unknown'))
        setIsStreaming(false)
      }
    },
    [client, workflowName],
  )

  return { run, events, latestMessage, contentChunks, isStreaming, isComplete, error, reset, cancel }
}
