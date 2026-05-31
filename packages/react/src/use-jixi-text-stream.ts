import { useState, useRef, useEffect, useCallback } from 'react'
import type { RunWorkflowOptions } from '@jixi/js'
import { useJixiStream } from './use-jixi-stream'
import type { JixiTextStreamResult } from './types'

export function useJixiTextStream<TIn>(
  workflowName: string,
  options?: RunWorkflowOptions,
): JixiTextStreamResult<TIn> {
  const base = useJixiStream<TIn>(workflowName, options)
  const [text, setText] = useState('')
  const [isDone, setIsDone] = useState(false)
  const processedRef = useRef(0)

  // Scan only newly appended content chunks; ignore audio
  useEffect(() => {
    const newChunks = base.contentChunks.slice(processedRef.current)
    processedRef.current = base.contentChunks.length
    for (const chunk of newChunks) {
      if (chunk.contentType !== 'text') continue
      setText((prev) => prev + chunk.chunk)
      if (chunk.done) setIsDone(true)
    }
  }, [base.contentChunks])

  const reset = useCallback(() => {
    processedRef.current = 0
    setText('')
    setIsDone(false)
    base.reset()
  }, [base.reset])

  return {
    run: base.run,
    text,
    isDone,
    isStreaming: base.isStreaming,
    isComplete: base.isComplete,
    error: base.error,
    reset,
    cancel: base.cancel,
  }
}
