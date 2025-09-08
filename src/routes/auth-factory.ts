import type { RequestAuth } from './types.js';

// WeakMap for storing sensitive data that won't be enumerable or serializable
const secretStorage = new WeakMap<RequestAuth, { password?: string; derivedKey?: string }>();

/**
 * Creates a RequestAuth object with secure ephemeral storage for sensitive data.
 * Secrets are stored in a WeakMap and accessed via getter functions that clear
 * the data after first access to prevent leakage through spread/JSON/structuredClone.
 */
export function createRequestAuth(params: {
  userId?: string | number | bigint;
  authenticated: boolean;
  password?: string;
  derivedKey?: string;
}): RequestAuth {
  const auth: RequestAuth = {
    userId: params.userId,
    authenticated: params.authenticated,
  };

  // Store secrets in WeakMap if provided
  if (params.password || params.derivedKey) {
    const secrets: { password?: string; derivedKey?: string } = {};
    
    if (params.password) {
      secrets.password = params.password;
    }
    
    if (params.derivedKey) {
      secrets.derivedKey = params.derivedKey;
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
        value: (): string | undefined => {
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