/**
 * Shared cryptographic utility functions for NIP-04 and NIP-44 routes
 */

import type { ServerBifrostNode } from './types.js';
import { withTimeout } from './utils.js';

/**
 * Converts a public key to x-only format (32 bytes hex).
 * Accepts both compressed (33 bytes with 02/03 prefix) and x-only formats.
 *
 * @param pubkey - Hex-encoded public key (compressed or x-only)
 * @returns 32-byte x-only hex string, or null if invalid
 */
export function xOnly(pubkey: string): string | null {
  let hex = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  if (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) return hex.slice(2);
  if (hex.length === 64) return hex;
  return null;
}

/**
 * Derives a shared secret using ECDH with the Bifrost node.
 * Used for NIP-04 and NIP-44 encryption/decryption operations.
 *
 * @param node - The Bifrost node instance
 * @param peerXOnly - X-only public key of the peer (32 bytes hex)
 * @param timeoutMs - Timeout in milliseconds for the ECDH operation
 * @returns Hex-encoded shared secret
 * @throws Error if ECDH fails or times out
 */
export async function deriveSharedSecret(
  node: ServerBifrostNode,
  peerXOnly: string,
  timeoutMs: number
): Promise<string> {
  if (typeof peerXOnly !== 'string' || peerXOnly.trim().length === 0) {
    throw new Error('Invalid peer public key: expected non-empty hex string');
  }

  const normalizedPeer = peerXOnly.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedPeer)) {
    throw new Error('Invalid peer public key: expected 32-byte x-only hex');
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid timeout: expected positive integer milliseconds');
  }

  const result: any = await withTimeout(node.req.ecdh(normalizedPeer), timeoutMs, 'ECDH_TIMEOUT');
  if (!result || result.ok !== true) {
    throw new Error(result?.error || 'ecdh failed');
  }

  const secret = typeof result.data === 'string' ? result.data.trim().toLowerCase() : null;
  if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
    throw new Error('Invalid ECDH secret: expected 32-byte hex string');
  }

  return secret;
}
