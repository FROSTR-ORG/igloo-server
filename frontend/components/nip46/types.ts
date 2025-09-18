export interface PermissionPolicy {
  methods: Record<string, boolean>
  kinds: Record<string, boolean>
}

export interface SessionProfile {
  name?: string
  url?: string
  image?: string
}

export interface SignerSession {
  pubkey: string
  created_at: number
  profile: SessionProfile
  policy?: PermissionPolicy
  status?: 'active' | 'pending'
  // Not persisted: requested permissions parsed from nostrconnect URI or connect params
  requested?: PermissionPolicy
}

export interface PermissionRequest {
  id: string
  method: string
  params: string[]
  session: SignerSession
  stamp: number
  deniedReason?: string
}

export interface NIP46Request {
  id: string
  method: string
  source: string
  content: unknown
  timestamp: number
  session_origin: {
    name?: string
    image?: string
    pubkey: string
    url?: string
  }
  request_type: 'note_signature' | 'base'
  status: 'pending' | 'approved' | 'denied'
  deniedReason?: string
}

export interface NIP46Config {
  relays: string[]
  policy: PermissionPolicy
  profile: SessionProfile
  timeout?: number
}
