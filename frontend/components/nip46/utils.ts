import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

export function shareToPrivateKey(shareCredential: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(shareCredential)) return shareCredential
  const input = shareCredential.startsWith('bfshare') ? shareCredential : shareCredential
  const hash = sha256(new TextEncoder().encode(input))
  return bytesToHex(hash)
}

export function formatPubkey(pubkey: string): string {
  if (!pubkey || pubkey.length < 24) return pubkey
  return `${pubkey.slice(0, 12)}...${pubkey.slice(-12)}`
}

export function getEventKindName(kind: number | string): string {
  const k = typeof kind === 'string' ? parseInt(kind, 10) : kind
  const names: Record<number, string> = {
    0: 'Metadata', 1: 'Text Note', 2: 'Recommend Server', 3: 'Contact List', 4: 'Direct Message', 5: 'Event Deletion', 6: 'Repost', 7: 'Reaction', 8: 'Badge Award', 16: 'Generic Repost',
    40: 'Channel Creation', 41: 'Channel Metadata', 42: 'Channel Message', 43: 'Channel Hide Message', 44: 'Channel Mute User', 1984: 'Report', 9734: 'Zap Request', 9735: 'Zap',
    10000: 'Mute List', 10001: 'Pin List', 10002: 'Relay List', 30000: 'Categorized People List', 30001: 'Categorized Bookmark List', 30008: 'Profile Badges', 30009: 'Badge Definition',
    30023: 'Long-form Content', 30024: 'Draft Long-form Content', 30078: 'Application-specific Data'
  }
  return names[k] || `Kind ${k}`
}

