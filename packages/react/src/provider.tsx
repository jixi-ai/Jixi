import React, { createContext, useContext, type ReactNode } from 'react'
import { JixiClient, type JixiConfig } from '@jixi/js'

const JixiContext = createContext<JixiClient | null>(null)

export interface JixiProviderProps {
  config?: JixiConfig
  children: ReactNode
}

export function JixiProvider({ config, children }: JixiProviderProps) {
  const client = React.useMemo(() => new JixiClient(config), [config])
  return <JixiContext.Provider value={client}>{children}</JixiContext.Provider>
}

export function useJixiContext(): JixiClient {
  const client = useContext(JixiContext)
  if (!client) throw new Error('useJixi must be used within a JixiProvider')
  return client
}
