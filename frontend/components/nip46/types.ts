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
}

export interface PermissionRequest {
  id: string
  method: string
  params: string[]
  session: SignerSession
  stamp: number
}

export interface NIP46Request {
  id: string
  method: string
  source: string
  content: any
  timestamp: number
  session_origin: {
    name?: string
    image?: string
    pubkey: string
    url?: string
  }
  request_type: 'note_signature' | 'base'
  status: 'pending' | 'approved' | 'denied'
  deniedReason?: string  // Reason why request was blocked by policy
}

export interface NIP46Config {
  relays: string[]
  policy: PermissionPolicy
  profile: SessionProfile
  timeout?: number
}