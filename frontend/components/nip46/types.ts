export interface PermissionPolicy {
  methods: Record<string, boolean>
  kinds: Record<string, boolean>
}

export interface PolicyPatch {
  methods?: Record<string, boolean>
  kinds?: Record<string, boolean>
}

export interface SessionProfile {
  name?: string
  url?: string
  image?: string
}

export interface Nip46SessionApi {
  pubkey: string
  status: 'active' | 'pending' | 'revoked'
  profile: SessionProfile
  relays?: string[]
  policy?: PermissionPolicy
  created_at: string
  updated_at?: string
  last_active_at?: string | null
  recent_kinds?: number[]
  recent_methods?: string[]
}

export interface Nip46RequestApi {
  id: string
  user_id: number | string
  session_pubkey: string
  method: string
  params: string
  status: 'pending' | 'approved' | 'denied' | 'completed' | 'failed' | 'expired'
  result?: string | null
  error?: string | null
  created_at: string
  updated_at: string
  expires_at?: string | null
}
