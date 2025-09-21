import type { RequestAuth } from './types.js';
import { vaultGetOnce, refreshSessionDerivedKey, rehydrateSessionDerivedKey } from './auth.js';
import { zeroizeUint8 } from '../util/zeroize.js';

// WeakMap for storing sensitive data that won't be enumerable or serializable
const secretStorage = new WeakMap<RequestAuth, { derivedKey?: Uint8Array; sessionId?: string; hasPassword?: boolean }>();
const secretFinalizer = typeof globalThis.FinalizationRegistry !== 'undefined'
  ? new globalThis.FinalizationRegistry<{ derivedKey?: Uint8Array }>((value) => {
      if (value?.derivedKey) zeroizeUint8(value.derivedKey);
    })
  : null;

/**
 * Creates a RequestAuth object with secure ephemeral storage for sensitive data.
 * Secrets are stored in a WeakMap and accessed via getter functions that clear
 * the data after first access to prevent leakage through spread/JSON/structuredClone.
 */
export function createRequestAuth(params: {
  userId?: string | number; // Only JSON-serializable types
  authenticated: boolean;
  derivedKey?: Uint8Array | string | null; // Accept binary or hex string derived key
  sessionId?: string; // Session ID for lazy vault retrieval
  hasPassword?: boolean; // Flag indicating if password is available in vault
}): RequestAuth {
  const auth: RequestAuth = {
    userId: params.userId,
    authenticated: params.authenticated,
  };

  // Store secrets in WeakMap if provided
  const secrets: { derivedKey?: Uint8Array; sessionId?: string; hasPassword?: boolean } = {};

  if (params.derivedKey != null) {
    
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

  // Store sessionId for lazy retrieval if provided
  if (params.sessionId) {
    secrets.sessionId = params.sessionId;
  }

  // Store hasPassword flag if provided
  if (params.hasPassword) {
    secrets.hasPassword = params.hasPassword;
  }

  // Only store in WeakMap if we have secrets
  if (secrets.derivedKey || secrets.sessionId || secrets.hasPassword) {
    secretStorage.set(auth, secrets);
    secretFinalizer?.register(auth, secrets, secrets);
  }

  // Add secure getter for derivedKey with lazy vault retrieval
  // Only add if we have a direct key or password-based auth with sessionId
  if (params.derivedKey != null || (params.sessionId && params.hasPassword)) {
    Object.defineProperty(auth, 'getDerivedKey', {
      enumerable: false,
      configurable: false,
      writable: false,
      value: (): Uint8Array | undefined => {
        const secrets = secretStorage.get(auth);

        // First check if we have a direct derivedKey
        if (secrets?.derivedKey !== undefined) {
          // Return a copy to prevent external modification
          // Do NOT clear the key - it's valid for the duration of this request
          return new Uint8Array(secrets.derivedKey);
        }

        // If no direct key but we have a sessionId, try lazy retrieval from vault
        if (secrets?.sessionId) {
          try {
            const keyFromVault = vaultGetOnce(secrets.sessionId);
            if (keyFromVault) {
              // Refresh vault TTL/read counters and update session cache
              refreshSessionDerivedKey(secrets.sessionId, keyFromVault);
              if (secrets.derivedKey) zeroizeUint8(secrets.derivedKey);
              secrets.derivedKey = keyFromVault;
              return new Uint8Array(keyFromVault);
            }

            if (secrets?.hasPassword) {
              const rehydrated = rehydrateSessionDerivedKey(secrets.sessionId);
              if (rehydrated) {
                if (secrets.derivedKey) zeroizeUint8(secrets.derivedKey);
                secrets.derivedKey = rehydrated;
                return new Uint8Array(rehydrated);
              }
            }
          } catch (error) {
            console.error('[auth] Failed to hydrate derived key from vault:', error);
            return undefined;
          }
        }

        return undefined;
      },
    });
  }

  Object.defineProperty(auth, 'destroySecrets', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: () => {
      const secrets = secretStorage.get(auth);
      if (!secrets) return;
      if (secrets.derivedKey) {
        zeroizeUint8(secrets.derivedKey);
        secrets.derivedKey = undefined;
      }
      secretFinalizer?.unregister(secrets);
      secretStorage.delete(auth);
    }
  });

  return auth;
}
