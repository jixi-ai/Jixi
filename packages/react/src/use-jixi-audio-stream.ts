import { useState, useRef, useCallback, useEffect } from 'react'
import { JixiError } from '@jixi/js'
import type { AudioStream, AudioStreamEvent, AudioStreamOptions } from '@jixi/js'
import { useJixiClient } from './context'
import type { JixiAudioStreamResult } from './types'

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

  const streamRef = useRef<AudioStream | null>(null)

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

      for await (const event of stream) {
        setEvents((prev) => [...prev, event])

        switch (event.type) {
          case 'session_started': {
            const data = event.data as { fileId: string }
            setSessionId(event.sessionId)
            setFileId(data.fileId)
            break
          }
          case 'transcript_interim': {
            setInterimText((event.data as { text: string }).text)
            break
          }
          case 'transcript_final': {
            setTranscript((prev) => {
              const text = (event.data as { text: string }).text
              if (!prev) return text
              // If the new chunk starts with a speaker label, check whether to merge
              // with the last line (same speaker continues) or start a new line
              const newLabelMatch = text.match(/^\[Speaker (\d+)\] (.+)/)
              if (newLabelMatch) {
                const prevLines = prev.split('\n')
                const lastLine = prevLines[prevLines.length - 1]
                const prevLabelMatch = lastLine.match(/^\[Speaker (\d+)\] /)
                if (prevLabelMatch && prevLabelMatch[1] === newLabelMatch[1]) {
                  // Same speaker — merge into the last line without repeating the label
                  prevLines[prevLines.length - 1] = lastLine + ' ' + newLabelMatch[2]
                  return prevLines.join('\n')
                }
              }
              return prev + '\n' + text
            })
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
