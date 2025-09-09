import type { RequestAuth } from './types.js';

// WeakMap for storing sensitive data that won't be enumerable or serializable
const secretStorage = new WeakMap<RequestAuth, { password?: string; derivedKey?: Uint8Array }>();

/**
 * Creates a RequestAuth object with secure ephemeral storage for sensitive data.
 * Secrets are stored in a WeakMap and accessed via getter functions that clear
 * the data after first access to prevent leakage through spread/JSON/structuredClone.
 */
export function createRequestAuth(params: {
  userId?: string | number | bigint;
  authenticated: boolean;
  password?: string;
  derivedKey?: string | null; // Accept hex string; preserve null from converters
}): RequestAuth {
  const auth: RequestAuth = {
    userId: params.userId,
    authenticated: params.authenticated,
  };

  // Store secrets in WeakMap if provided
  if (params.password || params.derivedKey) {
    const secrets: { password?: string; derivedKey?: Uint8Array } = {};
    
    if (params.password) {
      secrets.password = params.password;
    }
    
    if (params.derivedKey) {
      // Convert validated hex string to Uint8Array for binary storage
      const trimmed = params.derivedKey.trim();
      const hexKey = trimmed.replace(/^0x/i, '');
      if (hexKey.length === 0) throw new Error('Invalid derivedKey: empty hex string');
      if (hexKey.length !== 64) throw new Error('Invalid derivedKey: expected 64 hex characters for 32-byte key');
      if (hexKey.length % 2 !== 0) throw new Error('Invalid derivedKey: hex length must be even');
      if (!/^[0-9a-fA-F]+$/.test(hexKey)) throw new Error('Invalid derivedKey: non-hex characters present');

      const buffer = Buffer.from(hexKey, 'hex');
      secrets.derivedKey = new Uint8Array(buffer);
    }
    
    secretStorage.set(auth, secrets);
    
    // Add secure getter for password that clears after access
    if (params.password) {
      Object.defineProperty(auth, 'getPassword', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: (): string | undefined => {
          const secrets = secretStorage.get(auth);
          if (secrets?.password !== undefined) {
            const password = secrets.password;
            delete secrets.password;
            if (!secrets.password && !secrets.derivedKey) {
              secretStorage.delete(auth);
            }
            return password;
          }
          return undefined;
        },
      });
    }
    
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
            if (!secrets.password && !secrets.derivedKey) {
              secretStorage.delete(auth);
            }
            return derivedKey;
          }
          return undefined;
        },
      });
    }
  }
  
  return auth;
}