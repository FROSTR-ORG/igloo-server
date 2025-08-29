// Shared types for request cards
import type { UseRequestsResult } from '@/demo/hooks/useRequests.js'

export interface SessionOrigin {
  name?: string
  image?: string
  pubkey: string
  url?: string
}

export interface PermRequest {
  id: string
  method: string
  source: string
  content?: unknown
  timestamp: number
  session_origin?: SessionOrigin
  request_type: 'base' | 'note_signature'
  status: 'pending' | 'approved' | 'denied'
}

export interface BaseCardProps {
  request: PermRequest
  isExpanded: boolean
  requests: UseRequestsResult
}

export interface NoteSignatureCardProps extends BaseCardProps {
  // Inherits requests hook from BaseCardProps
} 