import { useState, useRef, useCallback, useEffect } from 'react'
import { JixiError } from '@jixi/js'
import type { AudioHttpStream, AudioStream, AudioStreamEvent, AudioStreamOptions } from '@jixi/js'
import { useJixiClient } from './context'
import type { JixiAudioStreamResult } from './types'
import { applyAudioEvent } from './use-jixi-audio-session-events'

export function useJixiAudioStream(
  appId: string,
  options?: AudioStreamOptions,
): JixiAudioStreamResult {
  const client = useJixiClient()

  const [events, setEvents] = useState<AudioStreamEvent[]>([])
  const [transcript, setTranscript] = useState('')
  const [interimText, setInterimText] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [fileId, setFileId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<JixiError | null>(null)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const streamRef = useRef<AudioStream | AudioHttpStream | null>(null)
  const lastSeqRef = useRef(options?.lastSeenSeq ?? -1)

  useEffect(() => {
    return () => {
      streamRef.current?.cancel()
    }
  }, [])

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
    setTranscript('')
    setInterimText('')
    setSessionId(null)
    setFileId(null)
    setIsStreaming(false)
    setIsComplete(false)
    setError(null)
  }, [])

  const sendAudio = useCallback((buf: ArrayBuffer | Uint8Array) => {
    streamRef.current?.sendAudio(buf)
  }, [])

  const flush = useCallback(() => {
    streamRef.current?.flush()
  }, [])

  const finalize = useCallback(() => {
    streamRef.current?.finalize()
    setIsStreaming(false)
  }, [])

  const start = useCallback(async () => {
    streamRef.current?.cancel()

    setEvents([])
    setTranscript('')
    setInterimText('')
    setSessionId(null)
    setFileId(null)
    setError(null)
    setIsStreaming(true)
    setIsComplete(false)

    try {
      const stream = await client.startAudioStream(appId, optionsRef.current)
      streamRef.current = stream
      lastSeqRef.current = optionsRef.current?.lastSeenSeq ?? -1

      for await (const event of stream) {
        if (event.seq <= lastSeqRef.current) continue
        lastSeqRef.current = event.seq

        setEvents((prev) => [...prev, event])
        setSessionId(event.sessionId)
        applyAudioEvent(event, setTranscript, setInterimText, setFileId, setIsStreaming, setIsComplete, setError)
      }
    } catch (err) {
      if (err instanceof JixiError && err.code === 'aborted') return
      setError(err instanceof JixiError ? err : new JixiError(String(err), 'unknown'))
      setIsStreaming(false)
    }
  }, [client, appId])

  return {
    start,
    sendAudio,
    flush,
    finalize,
    cancel,
    reset,
    events,
    transcript,
    interimText,
    sessionId,
    fileId,
    isStreaming,
    isComplete,
    error,
  }
}
