import { useState, useRef, useCallback, useEffect } from 'react'
import { JixiError } from '@jixi/js'
import type { AudioSessionEventStream, AudioStreamEvent, AudioStreamOptions, EventStreamOptions } from '@jixi/js'
import { useJixiClient } from './context'
import type { JixiAudioSessionEventsResult } from './types'

export function useJixiAudioSessionEvents(
  appId: string,
  sessionId: string | null | undefined,
  options?: Pick<AudioStreamOptions, 'signal'> & EventStreamOptions,
): JixiAudioSessionEventsResult {
  const client = useJixiClient()

  const [events, setEvents] = useState<AudioStreamEvent[]>([])
  const [transcript, setTranscript] = useState('')
  const [interimText, setInterimText] = useState('')
  const [fileId, setFileId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<JixiError | null>(null)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const streamRef = useRef<AudioSessionEventStream | null>(null)
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
    setTranscript('')
    setInterimText('')
    setFileId(null)
    setIsStreaming(false)
    setIsComplete(false)
    setError(null)
  }, [])

  useEffect(() => {
    if (!sessionId) {
      reset()
      return
    }

    let active = true
    streamRef.current?.cancel()
    lastSeqRef.current = optionsRef.current?.lastSeenSeq ?? -1
    setEvents([])
    setTranscript('')
    setInterimText('')
    setFileId(null)
    setError(null)
    setIsStreaming(true)
    setIsComplete(false)

    ;(async () => {
      try {
        const stream = await client.getAudioSessionEvents(appId, sessionId, optionsRef.current)
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
          applyAudioEvent(event, setTranscript, setInterimText, setFileId, setIsStreaming, setIsComplete, setError)
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
  }, [client, appId, sessionId, reset])

  return {
    events,
    transcript,
    interimText,
    sessionId: sessionId ?? null,
    fileId,
    isStreaming,
    isComplete,
    error,
    reset,
    cancel,
  }
}

export function appendTranscript(prev: string, text: string): string {
  if (!prev) return text
  const newLabelMatch = text.match(/^\[Speaker (\d+)\] (.+)/)
  if (newLabelMatch) {
    const prevLines = prev.split('\n')
    const lastLine = prevLines[prevLines.length - 1]
    const prevLabelMatch = lastLine.match(/^\[Speaker (\d+)\] /)
    if (prevLabelMatch && prevLabelMatch[1] === newLabelMatch[1]) {
      prevLines[prevLines.length - 1] = lastLine + ' ' + newLabelMatch[2]
      return prevLines.join('\n')
    }
  }
  return prev + '\n' + text
}

export function applyAudioEvent(
  event: AudioStreamEvent,
  setTranscript: (updater: (prev: string) => string) => void,
  setInterimText: (value: string) => void,
  setFileId: (value: string | null) => void,
  setIsStreaming: (value: boolean) => void,
  setIsComplete: (value: boolean) => void,
  setError: (value: JixiError | null) => void,
): void {
  switch (event.type) {
    case 'session_started': {
      const data = event.data as { fileId: string }
      setFileId(data.fileId)
      break
    }
    case 'transcript_interim': {
      setInterimText((event.data as { text: string }).text)
      break
    }
    case 'transcript_final': {
      setTranscript((prev) => appendTranscript(prev, (event.data as { text: string }).text))
      setInterimText('')
      break
    }
    case 'session_completed': {
      setInterimText('')
      setIsStreaming(false)
      setIsComplete(true)
      break
    }
    case 'session_failed': {
      setIsStreaming(false)
      setError(
        new JixiError(
          ((event.data as { error?: string }).error) ?? 'session_failed',
          'server_error',
        ),
      )
      break
    }
    default:
      break
  }
}
