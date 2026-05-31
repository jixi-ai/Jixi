import { useState, useRef, useEffect, useCallback } from 'react'
import type { WorkflowRunEvent, WorkflowRunEventType, RunWorkflowOptions } from '@jixi/js'
import { useJixiStream } from './use-jixi-stream'
import type { JixiEventStreamResult } from './types'

export function useJixiEventStream<TIn>(
  workflowName: string,
  eventType: WorkflowRunEventType,
  options?: RunWorkflowOptions,
): JixiEventStreamResult<TIn> {
  const base = useJixiStream<TIn>(workflowName, options)
  const [event, setEvent] = useState<WorkflowRunEvent | null>(null)
  const processedRef = useRef(0)

  // Reset when eventType changes so the next scan starts from the beginning
  useEffect(() => {
    processedRef.current = 0
    setEvent(null)
  }, [eventType])

  // Scan only newly appended events for the target type
  useEffect(() => {
    const newEvents = base.events.slice(processedRef.current)
    processedRef.current = base.events.length
    for (const e of newEvents) {
      if (e.type === eventType) setEvent(e)
    }
  }, [base.events, eventType])

  const reset = useCallback(() => {
    processedRef.current = 0
    setEvent(null)
    base.reset()
  }, [base.reset])

  return {
    run: base.run,
    event,
    isStreaming: base.isStreaming,
    error: base.error,
    reset,
    cancel: base.cancel,
  }
}
