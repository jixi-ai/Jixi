import { useJixiContext } from './provider'
import type { JixiClient } from '@jixi/js'

export function useJixi(): JixiClient {
  return useJixiContext()
}
