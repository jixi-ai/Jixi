import { useState, useRef, useEffect, useCallback } from 'react'
import { JixiError } from '@jixi/js'
import type {
  ContentChunkData,
  EventStreamOptions,
  JixiStream,
  RunWorkflowOptions,
  WorkflowFailedData,
  WorkflowMessageData,
  WorkflowRunEvent,
} from '@jixi/js'
import { useJixiClient } from './context'
import type { JixiRunEventsResult } from './types'

export function useJixiRunEvents(
  workflowName: string,
  runId: string | null | undefined,
  options?: RunWorkflowOptions & EventStreamOptions,
): JixiRunEventsResult {
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
  const lastSeqRef = useRef(options?.lastSeenSeq ?? -1)

  const cancel = useCallback(() => {
    streamRef.current?.cancel()
    streamRef.current = null
    setIsStreaming(false)
  }, [])

  const reset = useCallback(() => {
    streamRef.current?.cancel()
    streamRef.current = null
    lastSeqRef.current = optionsRef.current?.lastSeenSeq ?? -1
    setEvents([])
    setLatestMessage(null)
    setContentChunks([])
    setIsStreaming(false)
    setIsComplete(false)
    setError(null)
  }, [])

  useEffect(() => {
    if (!runId) {
      reset()
      return
    }

    let active = true
    streamRef.current?.cancel()
    lastSeqRef.current = optionsRef.current?.lastSeenSeq ?? -1
    setEvents([])
    setLatestMessage(null)
    setContentChunks([])
    setError(null)
    setIsStreaming(true)
    setIsComplete(false)

    ;(async () => {
      try {
        const stream = await client.getWorkflowRunEvents(workflowName, runId, optionsRef.current)
        if (!active) {
          stream.cancel()
          return
        }
        streamRef.current = stream

        for await (const event of stream) {
          if (!active) return
          if (event.seq <= lastSeqRef.current) continue
          lastSeqRef.current = event.seq

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
        if (!active || (err instanceof JixiError && err.code === 'aborted')) return
        setError(err instanceof JixiError ? err : new JixiError(String(err), 'unknown'))
        setIsStreaming(false)
      }
    })()

    return () => {
      active = false
      streamRef.current?.cancel()
    }
  }, [client, workflowName, runId, reset])

  return { events, latestMessage, contentChunks, isStreaming, isComplete, error, reset, cancel }
}
