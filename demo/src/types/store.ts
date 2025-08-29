import type { RelayPolicy }   from '@/demo/types/node.js'
import type { SignerSession } from '@/types/index.js'

export interface AppStore {
  encrypted : string | null
  relays    : RelayPolicy[]
  sessions  : SignerSession[]
  notificationsEnabled : boolean
}
