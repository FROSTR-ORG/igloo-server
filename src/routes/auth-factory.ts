import type { RequestAuth } from './types.js';

// WeakMap for storing sensitive data that won't be enumerable or serializable
const secretStorage = new WeakMap<RequestAuth, { derivedKey?: Uint8Array }>();

/**
 * Creates a RequestAuth object with secure ephemeral storage for sensitive data.
 * Secrets are stored in a WeakMap and accessed via getter functions that clear
 * the data after first access to prevent leakage through spread/JSON/structuredClone.
 */
export function createRequestAuth(params: {
  userId?: string | number | bigint;
  authenticated: boolean;
  derivedKey?: Uint8Array | string | null; // Accept binary or hex string derived key
}): RequestAuth {
  const auth: RequestAuth = {
    userId: params.userId,
    authenticated: params.authenticated,
  };

  // Store secrets in WeakMap if provided
  if (params.derivedKey) {
    const secrets: { derivedKey?: Uint8Array } = {};
    
    if (params.derivedKey) {
      const input = params.derivedKey as Uint8Array | string;
      let bytes: Uint8Array;
      if (typeof input === 'string') {
        const trimmed = input.trim();
        const hexKey = trimmed.replace(/^0x/i, '');
        if (hexKey.length === 0) throw new Error('Invalid derivedKey: empty hex string');
        if (hexKey.length % 2 !== 0) throw new Error('Invalid derivedKey: hex length must be even');
        if (!/^[0-9a-fA-F]+$/.test(hexKey)) throw new Error('Invalid derivedKey: non-hex characters present');
        // Expect 32-byte key (64 hex chars)
        if (hexKey.length !== 64) throw new Error('Invalid derivedKey: expected 64 hex characters for 32-byte key');
        
        // Convert hex to Uint8Array without Buffer
        const byteLength = hexKey.length / 2;
        bytes = new Uint8Array(byteLength);
        for (let i = 0; i < byteLength; i++) {
          bytes[i] = parseInt(hexKey.substring(i * 2, i * 2 + 2), 16);
        }
      } else {
        // Normalize to Uint8Array and defensively copy
        const normalized = new Uint8Array(input);
        if (normalized.length === 0) throw new Error('Invalid derivedKey: empty binary data');
        bytes = new Uint8Array(normalized);
      }
      secrets.derivedKey = bytes;
    }
    
    secretStorage.set(auth, secrets);
    
    // Add secure getter for derivedKey that clears after access
    if (params.derivedKey) {
      Object.defineProperty(auth, 'getDerivedKey', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: (): Uint8Array | undefined => {
          const secrets = secretStorage.get(auth);
          if (secrets?.derivedKey !== undefined) {
            const derivedKey = secrets.derivedKey;
            delete secrets.derivedKey;
            // Clean up the WeakMap entry since no secrets remain
            secretStorage.delete(auth);
            return derivedKey;
          }
          return undefined;
        },
      });
    }
  }
  
  return auth;
}