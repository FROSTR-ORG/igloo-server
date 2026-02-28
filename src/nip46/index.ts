import type { ServerBifrostNode } from '../routes/types.js'
import { Nip46Service } from './service.js'

let service: Nip46Service | null = null
let serviceInitOptions: InitOptions | null = null

interface InitOptions {
  addServerLog: (type: string, message: string, data?: any) => void
  broadcastEvent: (event: { type: string; message: string; data?: any; timestamp: string; id: string }) => void
  getNode: () => ServerBifrostNode | null
}

function areInitOptionsEquivalent(a: InitOptions, b: InitOptions): boolean {
  return (
    a.addServerLog === b.addServerLog &&
    a.broadcastEvent === b.broadcastEvent &&
    a.getNode === b.getNode
  )
}

export function initNip46Service(opts: InitOptions): Nip46Service {
  if (service) {
    if (!serviceInitOptions || !areInitOptionsEquivalent(serviceInitOptions, opts)) {
      console.warn('Reusing existing Nip46Service with different init options.')
    }
    return service
  }
  service = new Nip46Service(opts)
  serviceInitOptions = { ...opts }
  return service
}

export function getNip46Service(): Nip46Service | null {
  return service
}
