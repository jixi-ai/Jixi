import { provide, inject } from 'vue'
import { JixiClient, type JixiConfig } from '@jixi/js'

const JIXI_KEY = Symbol('jixi')

export function provideJixi(config?: JixiConfig): JixiClient {
  const client = new JixiClient(config)
  provide(JIXI_KEY, client)
  return client
}

export function injectJixi(): JixiClient {
  const client = inject<JixiClient>(JIXI_KEY)
  if (!client) throw new Error('useJixi must be called within a component that has provideJixi')
  return client
}
