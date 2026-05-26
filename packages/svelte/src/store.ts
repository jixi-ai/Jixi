import { writable } from 'svelte/store'
import { JixiClient, type JixiConfig } from '@jixi/js'

export function createJixiStore(config?: JixiConfig) {
  const client = new JixiClient(config)
  const { subscribe, set } = writable(client)
  return { subscribe, set, client }
}
