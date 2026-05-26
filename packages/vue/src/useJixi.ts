import { injectJixi } from './provide'
import type { JixiClient } from '@jixi/js'

export function useJixi(): JixiClient {
  return injectJixi()
}
