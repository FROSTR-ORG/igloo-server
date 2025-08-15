import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

// Convert FROSTR share credential to a hex private key for NIP46
export function shareToPrivateKey(shareCredential: string): string {
  // If it's already a 64-char hex string, return as-is
  if (/^[0-9a-fA-F]{64}$/.test(shareCredential)) {
    return shareCredential
  }
  
  // If it starts with 'bfshare', extract the actual share data
  if (shareCredential.startsWith('bfshare')) {
    // For now, we'll hash the share to get a deterministic private key
    // In production, you might want to use the actual FROSTR library methods
    const hash = sha256(new TextEncoder().encode(shareCredential))
    return bytesToHex(hash)
  }
  
  // Otherwise, hash the input to get a deterministic private key
  const hash = sha256(new TextEncoder().encode(shareCredential))
  return bytesToHex(hash)
}

// Format a pubkey for display (truncated)
export function formatPubkey(pubkey: string): string {
  if (!pubkey || pubkey.length < 24) return pubkey
  return `${pubkey.slice(0, 12)}...${pubkey.slice(-12)}`
}

// Get event kind name
export function getEventKindName(kind: number | string): string {
  const kindNum = typeof kind === 'string' ? parseInt(kind, 10) : kind
  
  const kinds: Record<number, string> = {
    0: 'Metadata',
    1: 'Text Note',
    2: 'Recommend Server',
    3: 'Contact List',
    4: 'Direct Message',
    5: 'Event Deletion',
    6: 'Repost',
    7: 'Reaction',
    8: 'Badge Award',
    16: 'Generic Repost',
    40: 'Channel Creation',
    41: 'Channel Metadata',
    42: 'Channel Message',
    43: 'Channel Hide Message',
    44: 'Channel Mute User',
    1984: 'Report',
    9734: 'Zap Request',
    9735: 'Zap',
    10000: 'Mute List',
    10001: 'Pin List',
    10002: 'Relay List',
    30000: 'Categorized People List',
    30001: 'Categorized Bookmark List',
    30008: 'Profile Badges',
    30009: 'Badge Definition',
    30023: 'Long-form Content',
    30024: 'Draft Long-form Content',
    30078: 'Application-specific Data'
  }
  
  return kinds[kindNum] || `Kind ${kind}`
}