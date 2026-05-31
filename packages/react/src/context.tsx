import { createContext, useContext, useMemo } from 'react'
import { JixiClient } from '@jixi/js'
import type { JixiProviderProps } from './types'

type JixiContextValue = { client: JixiClient }

const JixiContext = createContext<JixiContextValue | null>(null)

export function JixiProvider({
  children,
  baseUrl,
  apiKey,
  sessionTokenProvider,
  appId,
  timeoutMs,
  tokenTtlMs,
}: JixiProviderProps) {
  const client = useMemo(
    () => new JixiClient({ baseUrl, apiKey, sessionTokenProvider, appId, timeoutMs, tokenTtlMs }),
    [baseUrl, apiKey, sessionTokenProvider, appId, timeoutMs, tokenTtlMs],
  )
  return <JixiContext.Provider value={{ client }}>{children}</JixiContext.Provider>
}

export function useJixiClient(): JixiClient {
  const ctx = useContext(JixiContext)
  if (!ctx) throw new Error('[jixi] useJixiClient must be used inside a JixiProvider.')
  return ctx.client
}
