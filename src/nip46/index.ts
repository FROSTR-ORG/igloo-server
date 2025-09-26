import type { ServerBifrostNode } from '../routes/types.js'
import { Nip46Service } from './service.js'

let service: Nip46Service | null = null

interface InitOptions {
  addServerLog: (type: string, message: string, data?: any) => void
  broadcastEvent: (event: { type: string; message: string; data?: any; timestamp: string; id: string }) => void
  getNode: () => ServerBifrostNode | null
}

export function initNip46Service(opts: InitOptions): Nip46Service {
  service = new Nip46Service(opts)
  return service
}

export function getNip46Service(): Nip46Service | null {
  return service
}
