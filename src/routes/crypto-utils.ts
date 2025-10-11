/**
 * Shared cryptographic utility functions for NIP-04 and NIP-44 routes
 */

import type { ServerBifrostNode } from './types.js';
import { withTimeout, binaryToHex } from './utils.js';

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

  // Normalize ECDH result to 32-byte lowercase hex (minimal, robust)
  let secretHex: string | null = null;
  const data: any = result.data;

  // 1) Strings: allow 64-hex, compressed 66-hex (02/03+X), uncompressed 130-hex (04+X+Y), or base64/url encoding of 32 bytes
  if (typeof data === 'string') {
    const s0 = data.replace(/\s+/g, '').trim();
    const s = s0.startsWith('0x') ? s0.slice(2) : s0;
    const hex = s.toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hex)) secretHex = hex;
    else if (/^[0-9a-f]{66}$/.test(hex) && (hex.startsWith('02') || hex.startsWith('03'))) secretHex = hex.slice(2);
    else if (/^[0-9a-f]{130}$/.test(hex) && hex.startsWith('04')) secretHex = hex.slice(2, 66);
    else {
      const tryDecode = (input: string): string | null => {
        try {
          const buf = Buffer.from(input, 'base64');
          return buf.length === 32 ? buf.toString('hex') : null;
        } catch { return null; }
      };
      let decoded: string | null = null;
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(s)) decoded = tryDecode(s);
      if (!decoded && /^[A-Za-z0-9_-]+$/.test(s)) {
        let b = s.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b.length % 4; if (pad === 2) b += '=='; else if (pad === 3) b += '=';
        decoded = tryDecode(b);
      }
      if (decoded) secretHex = decoded;
    }
  }

  // 2) Binary: Buffer/Uint8Array
  if (!secretHex && (data instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(data)))) {
    const hex = binaryToHex(data as Uint8Array | Buffer);
    if (hex) {
      if (hex.length === 64) secretHex = hex;
      else if (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) secretHex = hex.slice(2);
      else if (hex.length === 130 && hex.startsWith('04')) secretHex = hex.slice(2, 66);
    }
  }

  if (!secretHex) {
    throw new Error('Invalid ECDH secret: expected 32-byte hex string');
  }

  return secretHex;
}
