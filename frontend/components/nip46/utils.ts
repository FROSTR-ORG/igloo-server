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

/**
 * Validates that a URL is safe to use as an image source.
 * Only allows http: and https: protocols to prevent XSS attacks.
 *
 * @param url - The URL to validate
 * @returns true if the URL is safe to use as an image source, false otherwise
 */
export function isValidImageUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function getFallbackAvatar(pubkey: string, size = 64): string {
  const trimmed = (pubkey || '').trim().toLowerCase()
  const seed = trimmed || 'nostr'
  return `https://www.gravatar.com/avatar/${seed}?d=identicon&s=${size}`
}
