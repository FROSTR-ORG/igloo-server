import type { ServerBifrostNode } from '../routes/types.js'
import { Nip46Service } from './service.js'

let service: Nip46Service | null = null
let serviceInitOptions: InitOptions | null = null
let initPromise: Promise<Nip46Service> | null = null

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

export async function initNip46Service(opts: InitOptions): Promise<Nip46Service> {
  if (initPromise) {
    await initPromise
  }

  if (service && serviceInitOptions && areInitOptionsEquivalent(serviceInitOptions, opts)) {
    return service
  }

  const existingService = service
  const nextInit = (async () => {
    if (existingService) {
      try {
        await existingService.stop()
      } catch (error) {
        console.warn('Failed to stop existing Nip46Service before reinit', error)
      }
    }

    const nextService = new Nip46Service(opts)
    service = nextService
    serviceInitOptions = { ...opts }
    return nextService
  })()

  initPromise = nextInit

  try {
    return await nextInit
  } finally {
    if (initPromise === nextInit) {
      initPromise = null
    }
  }
}

export function getNip46Service(): Nip46Service | null {
  return service
}
