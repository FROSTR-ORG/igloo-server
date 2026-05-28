/**
 * Shared cryptographic utility functions for NIP-04 and NIP-44 routes
 */

import { createHmac } from 'node:crypto';
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

interface EcdhResult {
  ok: boolean;
  data?: string | Buffer | Uint8Array;
  error?: string;
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

  const result: EcdhResult = await withTimeout(node.req.ecdh(normalizedPeer), timeoutMs, 'ECDH_TIMEOUT');
  if (!result || result.ok !== true) {
    throw new Error(result?.error || 'ecdh failed');
  }

  // Normalize ECDH result to 32-byte lowercase hex (minimal, robust)
  let secretHex: string | null = null;
  const data: EcdhResult['data'] = result.data;

  // 1) Strings: allow 64-hex, compressed 66-hex (02/03+X), uncompressed 130-hex (04+X+Y), or base64/url encoding of 32 bytes
  if (typeof data === 'string') {
    const s0 = data.replace(/\s+/g, '').trim();
    const s = s0.startsWith('0x') ? s0.slice(2) : s0;
    const hex = s.toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hex)) {
      secretHex = hex;
    } else if (/^[0-9a-f]{66}$/.test(hex) && (hex.startsWith('02') || hex.startsWith('03'))) {
      const sliced = hex.slice(2);
      if (!/^[0-9a-f]{64}$/.test(sliced)) {
        throw new Error('Invalid ECDH secret: expected 32-byte hex string');
      }
      secretHex = sliced;
    } else if (/^[0-9a-f]{130}$/.test(hex) && hex.startsWith('04')) {
      const sliced = hex.slice(2, 66);
      if (!/^[0-9a-f]{64}$/.test(sliced)) {
        throw new Error('Invalid ECDH secret: expected 32-byte hex string');
      }
      secretHex = sliced;
    } else {
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
      if (hex.length === 64) {
        if (!/^[0-9a-f]{64}$/.test(hex)) {
          throw new Error('Invalid ECDH secret: expected 32-byte hex string');
        }
        secretHex = hex;
      } else if (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) {
        const sliced = hex.slice(2);
        if (!/^[0-9a-f]{64}$/.test(sliced)) {
          throw new Error('Invalid ECDH secret: expected 32-byte hex string');
        }
        secretHex = sliced;
      } else if (hex.length === 130 && hex.startsWith('04')) {
        const sliced = hex.slice(2, 66);
        if (!/^[0-9a-f]{64}$/.test(sliced)) {
          throw new Error('Invalid ECDH secret: expected 32-byte hex string');
        }
        secretHex = sliced;
      }
    }
  }

  if (!secretHex) {
    throw new Error('Invalid ECDH secret: expected 32-byte hex string');
  }
  if (!/^[0-9a-f]{64}$/.test(secretHex)) {
    throw new Error('Invalid ECDH secret: expected 32-byte hex string');
  }

  return secretHex;
}

/**
 * Derive the NIP-44 v2 conversation key from a raw ECDH shared secret (`shared_x`).
 *
 * Per NIP-44 v2, the conversation key is:
 *   conversation_key = HKDF-extract(SHA-256, IKM=shared_x, salt="nip44-v2")
 *
 * Threshold ECDH on Bifrost returns the raw shared X coordinate as input keying
 * material; it MUST NOT be used as the conversation key directly. This helper
 * applies the spec HKDF-extract step so HTTP `/api/nip44/*` and NIP-46
 * `nip44_*` derive the exact same key from the same signer/peer relationship.
 *
 * @param sharedSecretHex - 32-byte ECDH shared secret as lowercase hex
 * @returns 32-byte NIP-44 v2 conversation key
 * @throws Error if the input is not a 32-byte hex string
 */
export function deriveNip44ConversationKey(sharedSecretHex: string): Uint8Array {
  if (typeof sharedSecretHex !== 'string' || !/^[0-9a-f]{64}$/.test(sharedSecretHex)) {
    throw new Error('Invalid shared secret: expected 32-byte hex string');
  }
  const sharedX = Buffer.from(sharedSecretHex, 'hex');
  // HKDF-extract(SHA-256, salt, IKM) = HMAC-SHA256(salt, IKM)
  const convBytes = createHmac('sha256', Buffer.from('nip44-v2', 'utf8')).update(sharedX).digest();
  return Uint8Array.from(convBytes);
}
